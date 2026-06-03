type ChatTestCase = {
  name: string;
  prompt: string;
  messages?: Array<{ role: string; content: string }>;
  userId?: string;
  expectWarning?: boolean;
  expectDiagnosisBlocked?: boolean;
  expectServiceRoutePath?: string;
  expectServiceRouteLabel?: string;
  expectClarification?: boolean;
  expectNoClarification?: boolean;
};

const CHAT_API_URL = process.env.CHAT_API_URL || "http://localhost:1337/api/chat";

const TEST_CASES: ChatTestCase[] = [
  {
    name: "General medicine info",
    prompt: "berikan aku informasi tentang obat hipertensi",
  },
  {
    name: "Critical interaction warning",
    prompt: "Validasi resep Warfarin + Aspirin",
    expectWarning: true,
  },
  {
    name: "Diagnosis request blocked",
    prompt: "diagnosa penyakit saya dari gejala batuk pilek",
    expectWarning: true,
    expectDiagnosisBlocked: true,
  },
  {
    name: "Fornas compliance query",
    prompt: "cek fornas bpjs untuk simvastatin",
  },
  {
    name: "ICD number by diagnosis",
    prompt: "tolong berikan nomor icd untuk diagnosa hipertensi",
  },
  {
    name: "Medicine number by medicine query",
    prompt: "cari obat warfarin dan nomor obatnya",
  },
  {
    name: "Prescription data by medicine query",
    prompt: "berapa peresepan obat warfarin di rsi",
  },
  {
    name: "Efornas availability by medicine query",
    prompt: "Apakah Parasetamol ada di e-Fornas?",
  },
  {
    name: "Full medicine catalog request",
    prompt: "tampilkan keseluruhan data obat di program darsi apoteker",
  },
  {
    name: "Service navigation for dispensing",
    prompt: "bantu aku untuk proses dispensing",
    userId: "apoteker-test-user",
    expectServiceRoutePath: "/apoteker/dispensing",
    expectServiceRouteLabel: "Dispensing",
  },
  {
    name: "Complex interaction triggers single clarification",
    prompt: "Obat saya aman diminum bersamaan?",
    expectClarification: true,
  },
  {
    name: "Clarification follow-up produces full answer",
    prompt: "Obat saya aman diminum bersamaan?",
    messages: [
      { role: "user", content: "Obat saya aman diminum bersamaan?" },
      {
        role: "assistant",
        content:
          "Sebelum saya jawab, boleh saya tanya dulu - obat apa saja yang sedang Bapak/Ibu konsumsi saat ini?",
      },
      { role: "user", content: "Warfarin dan Aspirin" },
    ],
    expectNoClarification: true,
    expectWarning: true,
  },
];

function extractStreamedText(sseRaw: string): string {
  const lines = sseRaw.split(/\r?\n/);
  let merged = "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }

    const jsonPart = line.slice(6).trim();
    if (!jsonPart) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
      if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
        merged += parsed.delta;
      }
    } catch {
      // Ignore malformed event chunks and continue collecting deltas.
    }
  }

  return merged.trim();
}

function assertDarsiAdaptiveAnswer(answer: string, testCase: ChatTestCase): string[] {
  const errors: string[] = [];
  const expectsServiceRoute = Boolean(testCase.expectServiceRoutePath);
  const expectsClarification = Boolean(testCase.expectClarification);

  if (expectsClarification) {
    if (!/^sebelum\s+saya\s+jawab,\s*boleh\s+saya\s+tanya\s+dulu\s*[-–—]\s*.+\?$/i.test(answer)) {
      errors.push("Clarification response does not follow required single-question format");
    }

    if (/\n\s*\n/.test(answer) || /referensi\s+internal\s*:/i.test(answer)) {
      errors.push("Clarification response should be short and should not include full final answer body");
    }

    return errors;
  }

  if (expectsServiceRoute) {
    if (!/layanan\s+yang\s+bisa\s+langsung\s+dibuka|saya\s+arahkan\s+ke\s+layanan/i.test(answer)) {
      errors.push("Service routing response is missing service navigation guidance");
    }

    if (testCase.expectServiceRouteLabel && !new RegExp(testCase.expectServiceRouteLabel, "i").test(answer)) {
      errors.push("Service routing response is missing expected service label");
    }

    if (testCase.expectServiceRoutePath && !answer.includes(testCase.expectServiceRoutePath)) {
      errors.push("Service routing response is missing expected service path");
    }

    if (/status\s+operasional\s+apoteker\s*\(live\)/i.test(answer)) {
      errors.push("Service routing response should not fallback to live operational status block");
    }

    return errors;
  }

  if (testCase.expectNoClarification && /sebelum\s+saya\s+jawab,\s*boleh\s+saya\s+tanya\s+dulu\s*[-–—]/i.test(answer)) {
    errors.push("Expected final answer, but chatbot asked clarification again");
  }

  const expectsIcdLookup = /icd|diagnos(?:is|a)|kode\s+penyakit/i.test(testCase.prompt);
  const expectsMedicineNumber = /nomor\s+obat|kode\s+obat|no\.?\s*obat/i.test(testCase.prompt);
  const expectsPrescriptionData = /peresepan|restriksi|aturan\s+resep|resep\s+maksimal/i.test(testCase.prompt);
  const expectsFornasAvailability = /fornas|e-?fornas|formularium|bpjs/i.test(testCase.prompt);
  const expectsFullMedicineCatalog =
    /\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b.*\b(data\s+)?obat\b/i.test(testCase.prompt) ||
    /\b(data\s+)?obat\b.*\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b/i.test(testCase.prompt);

  if (answer.length < 80) {
    errors.push("Response too short to be clinically useful");
  }

  if (!/referensi\s+internal\s*:/i.test(answer)) {
    errors.push("Missing internal reference line");
  }

  if (!/\[sumber\s*:\s*data\s+internal\s+rsi\s*\(.+\)\s*\]/i.test(answer)) {
    errors.push("Missing data source footer");
  }

  if (!/apakah\s+ada\s+obat\s+lain\s+dari\s+resep\s+dokter\s+yang\s+ingin\s+anda\s+cek\s+statusnya\?/i.test(answer)) {
    errors.push("Missing required follow-up question");
  }

  const dataSignals = [/icd-?10/i, /obat\s+kronis|kandidat\s+obat/i, /fornas|bpjs/i, /interaksi|kontraindikasi/i];
  const detectedSignals = dataSignals.filter((pattern) => pattern.test(answer)).length;
  if (detectedSignals < 1) {
    errors.push("Response does not explain enough tool-derived data");
  }

  if (!/rekomendasi|saran|langkah|tindak\s+lanjut|silakan|sebaiknya|klarifikasi|verifikasi|konsultasi|dokter|pantau/i.test(answer)) {
    errors.push("Response is missing actionable follow-up guidance");
  }

  if (!/referensi\s+internal|database\s+obat\s+kronis\s+rsi|e-?fornas|icd10\s+rsi|aturan\s+interaksi/i.test(answer)) {
    errors.push("Response is missing data source traceability");
  }

  if (!/informasi\s+belum\s+cukup|verifikasi\s+klinis|catatan\s+klinis/i.test(answer)) {
    errors.push("Response is missing uncertainty/clinical verification signal");
  }

  if (testCase.expectWarning && !/\*\*\[warning\s+klinis\]\*\*/i.test(answer)) {
    errors.push("Expected **[WARNING KLINIS]** prefix for critical scenario");
  }

  if (
    testCase.expectDiagnosisBlocked &&
    !/diagnosis diblokir|diagnosis tidak dapat diproses|tidak diproses|tidak menetapkan diagnosis|hanya untuk skrining obat|hanya mendukung validasi|tidak dapat memberikan diagnosis|tidak bisa memberikan diagnosis|tidak dapat mendiagnosis/i.test(answer)
  ) {
    errors.push("Expected diagnosis-block message for diagnosis query");
  }

  if (/^\s*\{/.test(answer) || /"status"\s*:|"icd10_matches"\s*:/i.test(answer)) {
    errors.push("Response still looks like raw JSON");
  }

  if (/stack\s*trace|traceback|exception\s*:|internal server error/i.test(answer)) {
    errors.push("Response contains technical error text");
  }

  if (expectsIcdLookup && !/kecocokan\s+icd-?10|nomor\s+icd/i.test(answer)) {
    errors.push("ICD lookup response is missing ICD context");
  }

  if (
    expectsIcdLookup &&
    !(/\b[a-z]\d{2}(?:\.\d{1,2})?\b/i.test(answer) || /tidak\s+ditemukan\s+di\s+database\s+icd10/i.test(answer))
  ) {
    errors.push("ICD lookup response is missing ICD code/not-found signal");
  }

  if (
    expectsMedicineNumber &&
    !(
      /(?:nomor\s+obat(?:\s+rsi)?|no\.?\s*(?:obat|rsi))[^0-9]{0,20}\d+/i.test(answer) ||
      /\[\s*no\.?\s*\d+\s*\]/i.test(answer)
    )
  ) {
    errors.push("Medicine query response is missing nomor obat RSI");
  }

  if (
    expectsPrescriptionData &&
    !(
      /peresepan\s+obat\s+rsi\s*:/i.test(answer) ||
      /peresepan\s*:/i.test(answer) ||
      /resep(?:an)?\s+maksimal/i.test(answer) ||
      /informasi\s+belum\s+tersedia/i.test(answer)
    )
  ) {
    errors.push("Prescription query response is missing peresepan/restriksi data");
  }

  if (/tool\s+tidak\s+dipanggil/i.test(answer)) {
    errors.push("Response still exposes skipped tool marker text");
  }

  if (
    expectsFornasAvailability &&
    !(
      /ditemukan\s+\d+\s+hasil\s+dari\s+e-?fornas/i.test(answer) ||
      /tidak\s+ditemukan\s+di\s+database\s+e-?fornas/i.test(answer) ||
      /parasetamol|paracetamol/i.test(answer)
    )
  ) {
    errors.push("Fornas query response is missing concrete e-Fornas result");
  }

  if (expectsFullMedicineCatalog && !/daftar\s+lengkap\s+obat\s+kronis\s+rsi\s+surabaya|data\s+obat\s+kronis\s+rsi/i.test(answer)) {
    errors.push("Full catalog response is missing RSI chronic medicine catalog section");
  }

  if (expectsFullMedicineCatalog && !/daftar\s+lengkap\s+obat\s+e-?fornas|data\s+obat\s+e-?fornas/i.test(answer)) {
    errors.push("Full catalog response is missing e-Fornas catalog section");
  }

  if (expectsFullMedicineCatalog && !/halaman\s*:\s*\d+\s*\/\s*\d+|halaman\s+\d+/i.test(answer)) {
    errors.push("Full catalog response is missing pagination guidance");
  }

  return errors;
}

async function queryChat(testCase: ChatTestCase): Promise<string> {
  const response = await fetch(CHAT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: testCase.messages ?? [{ role: "user", content: testCase.prompt }],
      conversationId: `test-structure-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      userId: testCase.userId ?? "test-structure-runner",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[${testCase.name}] Chat API returned ${response.status}: ${body}`);
  }

  const sseRaw = await response.text();
  return extractStreamedText(sseRaw);
}

async function main(): Promise<void> {
  const failures: Array<{ caseName: string; errors: string[]; answer: string }> = [];

  for (const testCase of TEST_CASES) {
    const answer = await queryChat(testCase);
    const errors = assertDarsiAdaptiveAnswer(answer, testCase);

    if (errors.length > 0) {
      failures.push({ caseName: testCase.name, errors, answer });
      continue;
    }

    console.log(`[PASS] ${testCase.name}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`\n[FAIL] ${failure.caseName}`);
      for (const error of failure.errors) {
        console.error(`- ${error}`);
      }
      console.error("Response preview:");
      console.error(failure.answer.slice(0, 700));
    }

    process.exitCode = 1;
    return;
  }

  console.log("\nAll DARSI adaptive response tests passed.");
}

main().catch((error) => {
  console.error("DARSI adaptive response test runner failed:");
  console.error(String(error));
  process.exitCode = 1;
});
