import * as fs from "fs";
import * as path from "path";

type TestCase = {
  id: string;
  query: string;
  expectContainsAny?: string[];
  expectContainsAll?: string[];
  expectNotContainsAny?: string[];
  expectSource?: "internal" | "general";
  expectReject?: boolean;
};

type EvalResult = {
  id: string;
  query: string;
  passed: boolean;
  responseText: string;
  checks: string[];
};

const TEST_FILE = path.join(process.cwd(), "data", "evaluation-test-cases.json");
const REPORT_DIR = path.join(process.cwd(), "reports");

const SOURCE_MARKERS = {
  internal: "[sumber: data obat kronis rsi & e-fornas]",
  general: "[sumber: pengetahuan umum model (tanpa data internal rsi/e-fornas)]",
} as const;

const REJECT_PHRASE = "hanya melayani pertanyaan seputar apoteker";
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
    process.env.VOLTAGENT_BACKEND_URL,
    process.env.NEXT_PUBLIC_VOLTAGENT_URL,
    "http://localhost:4300/api/chat",
    "http://localhost:1337/api/chat",
  ].filter((value): value is string => Boolean(value && value.trim()));

  const normalized = candidates.map(normalizeApiUrl);
  return Array.from(new Set(normalized));
}

async function callChat(query: string): Promise<string> {
  const candidates = selectedApiUrl ? [selectedApiUrl] : getApiCandidates();
  let lastError = "No API candidates available";

  for (const apiUrl of candidates) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: query }],
          userId: "eval-user",
          userRole: "apoteker",
          userMode: "apoteker",
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        lastError = `${apiUrl} returned ${response.status}: ${raw.slice(0, 300)}`;
        continue;
      }

      const chunks = raw
        .split(/\n\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => s.startsWith("data: "))
        .map((s) => s.slice(6));

      const text = chunks
        .map((jsonChunk) => {
          try {
            return JSON.parse(jsonChunk) as { type?: string; delta?: string };
          } catch {
            return null;
          }
        })
        .filter((v): v is { type?: string; delta?: string } => Boolean(v))
        .filter((v) => v.type === "text-delta")
        .map((v) => v.delta || "")
        .join("");

      selectedApiUrl = apiUrl;
      return text;
    } catch (error) {
      lastError = error instanceof Error ? `${apiUrl}: ${error.message}` : `${apiUrl}: ${String(error)}`;
    }
  }

  throw new Error(lastError);
}

function evaluateCase(testCase: TestCase, responseText: string): EvalResult {
  const checks: string[] = [];
  let passed = true;
  const normalizedText = responseText.toLowerCase();

  if (Array.isArray(testCase.expectContainsAny) && testCase.expectContainsAny.length > 0) {
    const hasAny = testCase.expectContainsAny.some((keyword) =>
      normalizedText.includes(keyword.toLowerCase())
    );
    checks.push(hasAny ? "contains-check:PASS" : "contains-check:FAIL");
    if (!hasAny) {
      passed = false;
    }
  }

  if (Array.isArray(testCase.expectContainsAll) && testCase.expectContainsAll.length > 0) {
    const hasAll = testCase.expectContainsAll.every((keyword) =>
      normalizedText.includes(keyword.toLowerCase())
    );
    checks.push(hasAll ? "contains-all-check:PASS" : "contains-all-check:FAIL");
    if (!hasAll) {
      passed = false;
    }
  }

  if (Array.isArray(testCase.expectNotContainsAny) && testCase.expectNotContainsAny.length > 0) {
    const hasForbidden = testCase.expectNotContainsAny.some((keyword) =>
      normalizedText.includes(keyword.toLowerCase())
    );
    const ok = !hasForbidden;
    checks.push(ok ? "not-contains-check:PASS" : "not-contains-check:FAIL");
    if (!ok) {
      passed = false;
    }
  }

  if (testCase.expectSource) {
    const expectedSourceMarker = SOURCE_MARKERS[testCase.expectSource];
    const hasSourceMarker = normalizedText.includes(expectedSourceMarker);
    checks.push(hasSourceMarker ? "source-check:PASS" : "source-check:FAIL");
    if (!hasSourceMarker) {
      passed = false;
    }
  }

  if (typeof testCase.expectReject === "boolean") {
    const rejected = normalizedText.includes(REJECT_PHRASE);
    const ok = testCase.expectReject ? rejected : !rejected;
    checks.push(ok ? "reject-check:PASS" : "reject-check:FAIL");
    if (!ok) {
      passed = false;
    }
  }

  return {
    id: testCase.id,
    query: testCase.query,
    passed,
    responseText,
    checks,
  };
}

async function main() {
  if (!fs.existsSync(TEST_FILE)) {
    throw new Error(`Test file not found: ${TEST_FILE}`);
  }

  const testCases = JSON.parse(fs.readFileSync(TEST_FILE, "utf-8")) as TestCase[];
  const results: EvalResult[] = [];

  for (const testCase of testCases) {
    try {
      const responseText = await callChat(testCase.query);
      results.push(evaluateCase(testCase, responseText));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: testCase.id,
        query: testCase.query,
        passed: false,
        responseText: "",
        checks: [`request-check:FAIL:${message}`],
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    timestamp: new Date().toISOString(),
    apiUrl: selectedApiUrl || getApiCandidates()[0] || "not-resolved",
    results,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = path.join(REPORT_DIR, `evaluation-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log(`Evaluation complete: ${summary.passed}/${summary.total} passed`);
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exit(1);
});
