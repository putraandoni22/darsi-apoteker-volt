import * as fs from "node:fs";
import * as path from "node:path";
import { calculateTokenAccuracy } from "./accuracy.js";
import { evaluationScenarios, type EvaluationScenario } from "./data.js";
import { calculateTokenF1 } from "./f1.js";
import { calculatePseudoPerplexity } from "./perplexity.js";

type SseEvent = Record<string, unknown>;

type ChatRunOutput = {
  generatedAnswer: string;
  calledTools: string[];
  toolSignalSource: "stream" | "heuristic" | "mixed";
  apiUrl: string;
  elapsedMs: number;
};

type IcdEvaluation = {
  pass: boolean;
  expectedCodes: string[];
  generatedCodes: string[];
  matchedCodes: string[];
  reason: string;
};

type ToolCallingEvaluation = {
  pass: boolean;
  expectedTools: string[];
  calledTools: string[];
  matchedTools: string[];
  missingTools: string[];
  extraTools: string[];
  source: "stream" | "heuristic" | "mixed";
};

type ScenarioEvaluationResult = {
  id: string;
  patientId: string;
  question: string;
  expectedAnswer: string;
  generatedAnswer: string;
  apiUrl: string;
  elapsedMs: number;
  toolCalling: ToolCallingEvaluation;
  icd10: IcdEvaluation;
  metrics: {
    f1: number;
    precision: number;
    recall: number;
    accuracy: number;
    exactMatch: boolean;
    pseudoPerplexity: number;
    crossEntropy: number;
  };
};

type AggregateSummary = {
  averageF1: number;
  averagePrecision: number;
  averageRecall: number;
  averageAccuracy: number;
  averagePseudoPerplexity: number;
  exactMatchRate: number;
  toolCallingPassRate: number;
  icdPassRate: number;
};

const KNOWN_TOOL_ALIASES: Record<string, string> = {
  "search_icd_code": "search_icd_code",
  "search-icd": "search_icd_code",
  icd: "search_icd_code",
  icd10: "search_icd_code",
  "search-medicines": "search-medicines",
  "search_medicines": "search-medicines",
  medicines: "search-medicines",
  obat: "search-medicines",
  "recommend-medicines": "recommend-medicines",
  "recommend_medicines": "recommend-medicines",
  rekomendasi: "recommend-medicines",
  "search-efornas": "search-efornas",
  "search_efornas": "search-efornas",
  fornas: "search-efornas",
  efornas: "search-efornas",
  "check_medication_interaction": "check_medication_interaction",
  "check-medication-interaction": "check_medication_interaction",
  interaction: "check_medication_interaction",
  interaksi: "check_medication_interaction",
  "get-live-system-status": "get-live-system-status",
  "get_live_system_status": "get-live-system-status",
  "live-system-status": "get-live-system-status",
  operasional: "get-live-system-status",
};

const TOOL_EVIDENCE_PATTERNS: Array<{ tool: string; pattern: RegExp }> = [
  { tool: "search_icd_code", pattern: /\bicd(?:-?10)?\b|\b[a-tv-z]\d{2}(?:\.\d{1,2})?\b/i },
  {
    tool: "search-medicines",
    pattern: /obat\s+kronis|nomor\s+obat|peresepan\s+obat|data\s+obat\s+terkonfirmasi/i,
  },
  { tool: "recommend-medicines", pattern: /rekomendasi\s+obat|opsi\s+terapi|kandidat\s+obat/i },
  { tool: "search-efornas", pattern: /e-?fornas|formularium\s+nasional|bpjs/i },
  {
    tool: "check_medication_interaction",
    pattern: /interaksi|kontraindikasi|warning\s+klinis|risiko\s+perdarahan|efek\s+samping/i,
  },
  {
    tool: "get-live-system-status",
    pattern: /status\s+sistem\s+operasional|status\s+operasional\s+live|antrian|dispensing|stok\s+live/i,
  },
];

const ICD10_REGEX = /\b([A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?)\b/gi;
const REPORT_DIR = path.join(process.cwd(), "reports");
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
let selectedApiUrl: string | null = null;

function normalizeApiUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.endsWith("/api/chat")) {
    return trimmed;
  }
  return `${trimmed.replace(/\/+$/, "")}/api/chat`;
}

function getApiCandidates(): string[] {
  const candidates = [
    process.env.EVAL_API_URL,
    process.env.CHAT_API_URL,
    process.env.VOLTAGENT_BACKEND_URL,
    process.env.NEXT_PUBLIC_VOLTAGENT_URL,
    "http://localhost:1337/api/chat",
    "http://localhost:4300/api/chat",
  ].filter((item): item is string => Boolean(item && item.trim()));

  const normalized = candidates.map(normalizeApiUrl);
  return Array.from(new Set(normalized));
}

function toFiniteScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function round(value: number, digits = 4): number {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function normalizeToolName(rawName: string): string | null {
  const normalized = rawName.trim().toLowerCase();
  return KNOWN_TOOL_ALIASES[normalized] ?? null;
}

function parseSseEvents(rawText: string): SseEvent[] {
  const lines = rawText.split(/\r?\n/);
  const events: SseEvent[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }

    const payload = line.slice(6).trim();
    if (!payload) {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as SseEvent;
      events.push(parsed);
    } catch {
      // Ignore malformed chunks.
    }
  }

  return events;
}

function extractGeneratedAnswer(events: SseEvent[]): string {
  let merged = "";

  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type !== "text-delta") {
      continue;
    }

    if (typeof event.delta === "string") {
      merged += event.delta;
    }
  }

  return merged.trim();
}

function extractToolsFromStream(events: SseEvent[]): string[] {
  const found = new Set<string>();

  for (const event of events) {
    const candidateValues = [event.toolName, event.name, event.tool, event.toolId];
    for (const candidate of candidateValues) {
      if (typeof candidate !== "string") {
        continue;
      }

      const normalized = normalizeToolName(candidate);
      if (normalized) {
        found.add(normalized);
      }
    }

    if (Array.isArray(event.tools)) {
      for (const maybeTool of event.tools) {
        const normalized = typeof maybeTool === "string" ? normalizeToolName(maybeTool) : null;
        if (normalized) {
          found.add(normalized);
        }
      }
    }
  }

  return Array.from(found);
}

function inferToolsFromText(text: string): string[] {
  const found = new Set<string>();
  for (const entry of TOOL_EVIDENCE_PATTERNS) {
    if (entry.pattern.test(text)) {
      found.add(entry.tool);
    }
  }
  return Array.from(found);
}

function extractIcdCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const match of text.matchAll(ICD10_REGEX)) {
    const code = (match[1] ?? "").toUpperCase();
    if (code) {
      codes.add(code);
    }
  }
  return Array.from(codes);
}

function canonicalIcdCode(code: string): string {
  return code.toUpperCase().replace(/\./g, "");
}

function hasIcdMatch(expectedCode: string, generatedCode: string): boolean {
  const expected = canonicalIcdCode(expectedCode);
  const generated = canonicalIcdCode(generatedCode);
  return expected.startsWith(generated) || generated.startsWith(expected);
}

function evaluateIcd10(scenario: EvaluationScenario, generatedAnswer: string): IcdEvaluation {
  const generatedCodes = extractIcdCodes(generatedAnswer);
  const expectedCodesRaw =
    Array.isArray(scenario.expectedIcdCodes) && scenario.expectedIcdCodes.length > 0
      ? scenario.expectedIcdCodes
      : extractIcdCodes(scenario.expectedAnswer);
  const expectedCodes = expectedCodesRaw.map((code) => code.toUpperCase());

  const asksIcdContext = /icd|diagnosa|diagnosis|kode\s+penyakit|hipertensi|diabetes|asma/i.test(
    scenario.question.toLowerCase(),
  );

  if (expectedCodes.length === 0) {
    if (!asksIcdContext) {
      return {
        pass: true,
        expectedCodes: [],
        generatedCodes,
        matchedCodes: [],
        reason: "ICD-10 tidak diwajibkan untuk skenario ini.",
      };
    }

    return {
      pass: generatedCodes.length > 0,
      expectedCodes: [],
      generatedCodes,
      matchedCodes: generatedCodes,
      reason:
        generatedCodes.length > 0
          ? "Pertanyaan bernuansa diagnosis dan jawaban memuat kode ICD-10."
          : "Pertanyaan bernuansa diagnosis tetapi kode ICD-10 tidak muncul.",
    };
  }

  const matchedCodes = expectedCodes.filter((expectedCode) =>
    generatedCodes.some((generatedCode) => hasIcdMatch(expectedCode, generatedCode)),
  );

  return {
    pass: matchedCodes.length > 0,
    expectedCodes,
    generatedCodes,
    matchedCodes,
    reason:
      matchedCodes.length > 0
        ? `Kode ICD-10 cocok: ${matchedCodes.join(", ")}`
        : `Tidak ada kecocokan dari kode yang diharapkan: ${expectedCodes.join(", ")}`,
  };
}

function evaluateToolCalling(
  expectedTools: string[],
  calledTools: string[],
  source: "stream" | "heuristic" | "mixed",
): ToolCallingEvaluation {
  const expectedSet = new Set(expectedTools);
  const calledSet = new Set(calledTools);

  const matchedTools = expectedTools.filter((tool) => calledSet.has(tool));
  const missingTools = expectedTools.filter((tool) => !calledSet.has(tool));
  const extraTools = calledTools.filter((tool) => !expectedSet.has(tool));

  return {
    pass: missingTools.length === 0,
    expectedTools,
    calledTools,
    matchedTools,
    missingTools,
    extraTools,
    source,
  };
}

async function callChatLive(question: string, patientId: string): Promise<ChatRunOutput> {
  const candidates = selectedApiUrl ? [selectedApiUrl] : getApiCandidates();
  let lastError = "Tidak ada kandidat endpoint API yang tersedia.";

  for (const apiUrl of candidates) {
    const started = Date.now();
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: question }],
          userId: patientId,
          userRole: "apoteker",
          userMode: "apoteker",
          conversationId: `eval-${patientId}`,
          metadata: { patientId },
        }),
      });

      const rawBody = await response.text();
      if (!response.ok) {
        lastError = `${apiUrl} -> ${response.status}: ${rawBody.slice(0, 400)}`;
        continue;
      }

      const events = parseSseEvents(rawBody);
      const answer = extractGeneratedAnswer(events);
      const toolsFromStream = extractToolsFromStream(events);
      const toolsFromHeuristic = inferToolsFromText(`${question}\n${answer}`);

      const mergedSet = new Set<string>([...toolsFromStream, ...toolsFromHeuristic]);
      const calledTools = Array.from(mergedSet);
      const source: "stream" | "heuristic" | "mixed" =
        toolsFromStream.length > 0 && toolsFromHeuristic.length > 0
          ? "mixed"
          : toolsFromStream.length > 0
            ? "stream"
            : "heuristic";

      selectedApiUrl = apiUrl;
      return {
        generatedAnswer: answer,
        calledTools,
        toolSignalSource: source,
        apiUrl,
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      lastError =
        error instanceof Error ? `${apiUrl} -> ${error.message}` : `${apiUrl} -> ${String(error)}`;
    }
  }

  throw new Error(lastError);
}

function callChatDryRun(scenario: EvaluationScenario): ChatRunOutput {
  const fallbackGenerated = `${scenario.expectedAnswer}\n\n[DRY RUN] Jawaban ini disimulasikan dari expected answer.`;
  return {
    generatedAnswer: fallbackGenerated,
    calledTools: [...scenario.expectedTools],
    toolSignalSource: "heuristic",
    apiUrl: "dry-run://local",
    elapsedMs: 0,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, val) => acc + val, 0) / values.length;
}

function buildAggregateSummary(results: ScenarioEvaluationResult[]): AggregateSummary {
  return {
    averageF1: average(results.map((result) => result.metrics.f1)),
    averagePrecision: average(results.map((result) => result.metrics.precision)),
    averageRecall: average(results.map((result) => result.metrics.recall)),
    averageAccuracy: average(results.map((result) => result.metrics.accuracy)),
    averagePseudoPerplexity: average(results.map((result) => result.metrics.pseudoPerplexity)),
    exactMatchRate: average(results.map((result) => (result.metrics.exactMatch ? 1 : 0))),
    toolCallingPassRate: average(results.map((result) => (result.toolCalling.pass ? 1 : 0))),
    icdPassRate: average(results.map((result) => (result.icd10.pass ? 1 : 0))),
  };
}

function buildMarkdownReport(params: {
  generatedAt: string;
  apiUrl: string;
  aggregate: AggregateSummary;
  results: ScenarioEvaluationResult[];
}): string {
  const { generatedAt, apiUrl, aggregate, results } = params;

  const tableHeader =
    "| ID | F1 | Accuracy | Pseudo-Perplexity | Tool Calling | ICD-10 | Waktu (ms) |\n| --- | ---: | ---: | ---: | --- | --- | ---: |";

  const tableRows = results
    .map((result) => {
      const toolStatus = result.toolCalling.pass
        ? `PASS (${result.toolCalling.calledTools.join(", ") || "-"})`
        : `FAIL (missing: ${result.toolCalling.missingTools.join(", ")})`;
      const icdStatus = result.icd10.pass
        ? `PASS (${result.icd10.matchedCodes.join(", ") || "N/A"})`
        : `FAIL (${result.icd10.reason})`;

      return `| ${result.id} | ${round(result.metrics.f1, 4)} | ${round(result.metrics.accuracy, 4)} | ${round(
        result.metrics.pseudoPerplexity,
        4,
      )} | ${toolStatus} | ${icdStatus} | ${result.elapsedMs} |`;
    })
    .join("\n");

  const perCaseSections = results
    .map((result) => {
      return [
        `## ${result.id}`,
        `- Patient ID: ${result.patientId}`,
        `- Question: ${result.question}`,
        `- API: ${result.apiUrl}`,
        `- Tool Calling: ${result.toolCalling.pass ? "PASS" : "FAIL"}`,
        `- Called Tools: ${result.toolCalling.calledTools.join(", ") || "-"}`,
        `- Missing Tools: ${result.toolCalling.missingTools.join(", ") || "-"}`,
        `- ICD-10 Check: ${result.icd10.pass ? "PASS" : "FAIL"}`,
        `- ICD Generated: ${result.icd10.generatedCodes.join(", ") || "-"}`,
        `- ICD Expected: ${result.icd10.expectedCodes.join(", ") || "-"}`,
        `- F1: ${round(result.metrics.f1, 6)}`,
        `- Precision: ${round(result.metrics.precision, 6)}`,
        `- Recall: ${round(result.metrics.recall, 6)}`,
        `- Accuracy: ${round(result.metrics.accuracy, 6)}`,
        `- Exact Match: ${result.metrics.exactMatch}`,
        `- Pseudo-Perplexity: ${round(result.metrics.pseudoPerplexity, 6)}`,
        `- Cross-Entropy: ${round(result.metrics.crossEntropy, 6)}`,
        "- Generated Answer:",
        "```text",
        result.generatedAnswer,
        "```",
      ].join("\n");
    })
    .join("\n\n");

  return [
    "# Automated Evaluation Report - AI Agent Kesehatan",
    "",
    `- Generated At: ${generatedAt}`,
    `- API URL: ${apiUrl}`,
    `- Total Scenarios: ${results.length}`,
    `- Average F1: ${round(aggregate.averageF1, 6)}`,
    `- Average Precision: ${round(aggregate.averagePrecision, 6)}`,
    `- Average Recall: ${round(aggregate.averageRecall, 6)}`,
    `- Average Accuracy: ${round(aggregate.averageAccuracy, 6)}`,
    `- Average Pseudo-Perplexity: ${round(aggregate.averagePseudoPerplexity, 6)}`,
    `- Exact Match Rate: ${round(aggregate.exactMatchRate, 6)}`,
    `- Tool Calling Pass Rate: ${round(aggregate.toolCallingPassRate, 6)}`,
    `- ICD-10 Pass Rate: ${round(aggregate.icdPassRate, 6)}`,
    "",
    "## Ringkasan Tabel",
    tableHeader,
    tableRows,
    "",
    "## Detail Per Skenario",
    perCaseSections,
    "",
  ].join("\n");
}

async function evaluateScenario(scenario: EvaluationScenario): Promise<ScenarioEvaluationResult> {
  const runOutput = DRY_RUN
    ? callChatDryRun(scenario)
    : await callChatLive(scenario.question, scenario.patientId);

  const f1 = calculateTokenF1(scenario.expectedAnswer, runOutput.generatedAnswer);
  const accuracy = calculateTokenAccuracy(scenario.expectedAnswer, runOutput.generatedAnswer);
  const perplexity = calculatePseudoPerplexity(runOutput.generatedAnswer, scenario.expectedAnswer, 2, 1);

  const toolCalling = evaluateToolCalling(
    scenario.expectedTools,
    runOutput.calledTools,
    runOutput.toolSignalSource,
  );

  const icd10 = evaluateIcd10(scenario, runOutput.generatedAnswer);

  return {
    id: scenario.id,
    patientId: scenario.patientId,
    question: scenario.question,
    expectedAnswer: scenario.expectedAnswer,
    generatedAnswer: runOutput.generatedAnswer,
    apiUrl: runOutput.apiUrl,
    elapsedMs: runOutput.elapsedMs,
    toolCalling,
    icd10,
    metrics: {
      f1: toFiniteScore(f1.f1),
      precision: toFiniteScore(f1.precision),
      recall: toFiniteScore(f1.recall),
      accuracy: toFiniteScore(accuracy.accuracy),
      exactMatch: accuracy.exactMatch,
      pseudoPerplexity: toFiniteScore(perplexity.perplexity),
      crossEntropy: toFiniteScore(perplexity.crossEntropy),
    },
  };
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const generatedAt = startedAt.toISOString();

  const results: ScenarioEvaluationResult[] = [];

  for (const scenario of evaluationScenarios) {
    try {
      const result = await evaluateScenario(scenario);
      results.push(result);
      console.log(
        `[${scenario.id}] selesai | F1=${round(result.metrics.f1)} | Acc=${round(result.metrics.accuracy)} | PPL=${round(
          result.metrics.pseudoPerplexity,
        )} | Tools=${result.toolCalling.calledTools.join(",") || "-"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: scenario.id,
        patientId: scenario.patientId,
        question: scenario.question,
        expectedAnswer: scenario.expectedAnswer,
        generatedAnswer: "",
        apiUrl: selectedApiUrl ?? "unknown",
        elapsedMs: 0,
        toolCalling: {
          pass: false,
          expectedTools: scenario.expectedTools,
          calledTools: [],
          matchedTools: [],
          missingTools: scenario.expectedTools,
          extraTools: [],
          source: "heuristic",
        },
        icd10: {
          pass: false,
          expectedCodes: scenario.expectedIcdCodes ?? [],
          generatedCodes: [],
          matchedCodes: [],
          reason: `Gagal evaluasi skenario: ${message}`,
        },
        metrics: {
          f1: 0,
          precision: 0,
          recall: 0,
          accuracy: 0,
          exactMatch: false,
          pseudoPerplexity: 0,
          crossEntropy: 0,
        },
      });
      console.error(`[${scenario.id}] gagal dievaluasi: ${message}`);
    }
  }

  const aggregate = buildAggregateSummary(results);
  const apiUsed = selectedApiUrl ?? (DRY_RUN ? "dry-run://local" : getApiCandidates()[0] ?? "not-resolved");

  console.log("\n=== Ringkasan Evaluasi Otomatis ===");
  console.table(
    results.map((result) => ({
      id: result.id,
      f1: round(result.metrics.f1),
      accuracy: round(result.metrics.accuracy),
      pseudoPerplexity: round(result.metrics.pseudoPerplexity),
      toolCallingPass: result.toolCalling.pass,
      icd10Pass: result.icd10.pass,
      toolsCalled: result.toolCalling.calledTools.join(", "),
      elapsedMs: result.elapsedMs,
    })),
  );

  console.log(`Average F1: ${round(aggregate.averageF1, 6)}`);
  console.log(`Average Accuracy: ${round(aggregate.averageAccuracy, 6)}`);
  console.log(`Average Pseudo-Perplexity: ${round(aggregate.averagePseudoPerplexity, 6)}`);
  console.log(`Tool Calling Pass Rate: ${round(aggregate.toolCallingPassRate, 6)}`);
  console.log(`ICD-10 Pass Rate: ${round(aggregate.icdPassRate, 6)}`);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportId = Date.now();
  const jsonPath = path.join(REPORT_DIR, `automated-evaluation-${reportId}.json`);
  const mdPath = path.join(REPORT_DIR, `automated-evaluation-${reportId}.md`);

  const reportJson = {
    generatedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    dryRun: DRY_RUN,
    apiUrl: apiUsed,
    aggregate: {
      averageF1: round(aggregate.averageF1, 8),
      averagePrecision: round(aggregate.averagePrecision, 8),
      averageRecall: round(aggregate.averageRecall, 8),
      averageAccuracy: round(aggregate.averageAccuracy, 8),
      averagePseudoPerplexity: round(aggregate.averagePseudoPerplexity, 8),
      exactMatchRate: round(aggregate.exactMatchRate, 8),
      toolCallingPassRate: round(aggregate.toolCallingPassRate, 8),
      icdPassRate: round(aggregate.icdPassRate, 8),
    },
    results,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), "utf-8");
  fs.writeFileSync(
    mdPath,
    buildMarkdownReport({
      generatedAt,
      apiUrl: apiUsed,
      aggregate,
      results,
    }),
    "utf-8",
  );

  console.log(`\nJSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);
}

main().catch((error) => {
  console.error("Automated evaluation pipeline gagal dijalankan:", error);
  process.exit(1);
});