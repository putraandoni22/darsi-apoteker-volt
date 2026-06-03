import { createTool } from "@voltagent/core";
import { z } from "zod";

function extractString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    if (typeof typed.value === "string") {
      return typed.value;
    }
    if (typeof typed.query === "string") {
      return typed.query;
    }
  }

  return String(value ?? "");
}

function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/[;,|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

const MEDICATION_ALIASES: Record<string, string> = {
  amlodipine: "amlodipine",
  amlodipin: "amlodipine",
  aspirin: "aspirin",
  "asam mefenamat": "asam-mefenamat",
  asammefenamat: "asam-mefenamat",
  atorvastatin: "atorvastatin",
  captopril: "captopril",
  clarithromycin: "clarithromycin",
  klarythromycin: "clarithromycin",
  clopidogrel: "clopidogrel",
  diclofenac: "diclofenac",
  digoxin: "digoxin",
  erythromycin: "erythromycin",
  ibuprofen: "ibuprofen",
  ketoconazole: "ketoconazole",
  lisinopril: "lisinopril",
  losartan: "losartan",
  metformin: "metformin",
  omeprazole: "omeprazole",
  paracetamol: "paracetamol",
  parasetamol: "paracetamol",
  ramipril: "ramipril",
  simvastatin: "simvastatin",
  valsartan: "valsartan",
  verapamil: "verapamil",
  warfarin: "warfarin",
};

const MEDICATION_SUFFIX_HINTS = [
  "dipine",
  "sartan",
  "pril",
  "statin",
  "formin",
  "mycin",
  "cillin",
  "azole",
  "profen",
  "acetamol",
  "farin",
  "xaban",
];

type Severity = "high" | "moderate";

type InteractionRule = {
  a: string;
  b: string;
  severity: Severity;
  issue: string;
  recommendation: string;
};

const INTERACTION_RULES: InteractionRule[] = [
  {
    a: "warfarin",
    b: "aspirin",
    severity: "high",
    issue: "Risiko perdarahan mayor meningkat tajam.",
    recommendation: "Evaluasi kebutuhan kombinasi; wajib pemantauan INR dan tanda perdarahan.",
  },
  {
    a: "warfarin",
    b: "ibuprofen",
    severity: "high",
    issue: "Risiko perdarahan gastrointestinal dan sistemik meningkat.",
    recommendation: "Hindari kombinasi jika memungkinkan; pertimbangkan analgesik alternatif.",
  },
  {
    a: "warfarin",
    b: "diclofenac",
    severity: "high",
    issue: "Risiko perdarahan meningkat.",
    recommendation: "Hindari kombinasi atau lakukan pengawasan ketat.",
  },
  {
    a: "simvastatin",
    b: "clarithromycin",
    severity: "high",
    issue: "Risiko miopati/rhabdomiolisis meningkat.",
    recommendation: "Hindari kombinasi; pertimbangkan antibiotik/stain alternatif.",
  },
  {
    a: "simvastatin",
    b: "erythromycin",
    severity: "high",
    issue: "Risiko toksisitas statin meningkat.",
    recommendation: "Hindari kombinasi atau hentikan sementara simvastatin sesuai evaluasi klinis.",
  },
  {
    a: "simvastatin",
    b: "ketoconazole",
    severity: "high",
    issue: "Peningkatan kadar statin dan risiko rhabdomiolisis.",
    recommendation: "Hindari kombinasi.",
  },
  {
    a: "clopidogrel",
    b: "omeprazole",
    severity: "moderate",
    issue: "Efek antiplatelet clopidogrel dapat menurun.",
    recommendation: "Pertimbangkan PPI alternatif dengan interaksi lebih rendah.",
  },
  {
    a: "digoxin",
    b: "verapamil",
    severity: "moderate",
    issue: "Kadar digoxin dapat meningkat.",
    recommendation: "Pertimbangkan pemantauan kadar/efek digoxin dan penyesuaian dosis.",
  },
  {
    a: "aspirin",
    b: "ibuprofen",
    severity: "moderate",
    issue: "Efek antiplatelet aspirin dapat menurun bila waktu pemberian tidak tepat.",
    recommendation: "Atur interval pemberian dan pertimbangkan analgesik lain.",
  },
];

function normalizeMedicationName(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  if (!lowered) {
    return "";
  }

  const compact = lowered.replace(/[^a-z0-9]/g, "");
  if (MEDICATION_ALIASES[compact]) {
    return MEDICATION_ALIASES[compact];
  }

  if (MEDICATION_ALIASES[lowered]) {
    return MEDICATION_ALIASES[lowered];
  }

  for (const [alias, canonical] of Object.entries(MEDICATION_ALIASES)) {
    if (compact === alias || compact.includes(alias)) {
      return canonical;
    }
  }

  return compact;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.length > 0)));
}

export function parseMedicationMentions(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);

  const candidates = tokens.filter((token) => {
    if (MEDICATION_ALIASES[token]) {
      return true;
    }

    return MEDICATION_SUFFIX_HINTS.some((suffix) => token.endsWith(suffix));
  });

  const normalized = candidates
    .map((token) => normalizeMedicationName(token))
    .filter((name) => Object.values(MEDICATION_ALIASES).includes(name));

  return dedupe(normalized);
}

function includesAny(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

export const checkMedicationInteraction = createTool({
  name: "check_medication_interaction",
  description:
    "Skrining rule-based interaksi obat dan kontraindikasi awal dari kombinasi obat pada pertanyaan user.",
  parameters: z.object({
    query: z.preprocess(
      (value) => extractString(value),
      z.string(),
    ).describe("Pertanyaan user atau konteks resep yang sedang disaring."),
    medicines: z
      .preprocess((value) => extractStringArray(value), z.array(z.string()))
      .optional()
      .describe("Daftar nama obat yang diketahui jika sudah tersedia."),
  }),
  execute: async ({ query, medicines }): Promise<string> => {
    const rawQuery = (query ?? "").trim();
    if (rawQuery.length < 2) {
      return "Masukkan konteks resep/obat minimal 2 karakter untuk skrining interaksi.";
    }

    const explicitMeds = (medicines ?? []).map((item) => normalizeMedicationName(item));
    const inferredMeds = parseMedicationMentions(rawQuery);
    const detectedMeds = dedupe([...explicitMeds, ...inferredMeds]).filter((item) =>
      Object.values(MEDICATION_ALIASES).includes(item),
    );

    if (detectedMeds.length === 0) {
      return [
        "SCREENING_INTERAKSI_OBAT:",
        "- Obat belum dapat diidentifikasi dari pertanyaan.",
        "- Mohon sebutkan minimal dua nama obat untuk skrining interaksi.",
      ].join("\n");
    }

    const medSet = new Set(detectedMeds);
    const findings: string[] = [];
    const recommendations: string[] = [];

    for (const rule of INTERACTION_RULES) {
      if (medSet.has(rule.a) && medSet.has(rule.b)) {
        const label = rule.severity === "high" ? "INTERAKSI SERIUS" : "INTERAKSI MODERAT";
        findings.push(`${label}: ${rule.a} + ${rule.b} -> ${rule.issue}`);
        recommendations.push(rule.recommendation);
      }
    }

    const queryLower = rawQuery.toLowerCase();

    if (
      includesAny(queryLower, ["hamil", "kehamilan", "trimester", "menyusui"]) &&
      detectedMeds.some((item) =>
        ["captopril", "lisinopril", "ramipril", "losartan", "valsartan", "warfarin", "simvastatin", "atorvastatin"].includes(
          item,
        ),
      )
    ) {
      findings.push("KONTRAINDIKASI: Obat tertentu pada regimen dapat berisiko tinggi pada kehamilan/menyusui.");
      recommendations.push("Verifikasi segera dengan dokter penanggung jawab sebelum melanjutkan terapi.");
    }

    if (
      includesAny(queryLower, ["asma", "asmatik"]) &&
      detectedMeds.some((item) => ["aspirin", "ibuprofen", "diclofenac", "asam-mefenamat"].includes(item))
    ) {
      findings.push("KONTRAINDIKASI RELATIF: NSAID tertentu dapat memperberat gejala pada pasien asma sensitif.");
      recommendations.push("Pertimbangkan alternatif analgesik dan konfirmasi ke dokter/apoteker klinis.");
    }

    if (
      includesAny(queryLower, ["gagal ginjal", "penurunan fungsi ginjal", "ggk"]) &&
      detectedMeds.some((item) => ["metformin", "ibuprofen", "diclofenac", "asam-mefenamat"].includes(item))
    ) {
      findings.push("PERINGATAN KLINIS: Terdapat obat yang perlu evaluasi ketat pada gangguan fungsi ginjal.");
      recommendations.push("Tinjau eGFR/fungsi ginjal dan sesuaikan terapi sesuai protokol klinis.");
    }

    const uniqueRecommendations = dedupe(recommendations);
    const lines: string[] = [];

    lines.push("SCREENING_INTERAKSI_OBAT:");
    lines.push(`- OBAT_TERDETEKSI: ${detectedMeds.join(", ")}`);

    if (findings.length === 0) {
      lines.push("- TEMUAN: Tidak ada interaksi/kontraindikasi serius dari aturan internal yang cocok.");
      lines.push("- CATATAN: Skrining ini rule-based, bukan pengganti keputusan klinis dokter.");
      return lines.join("\n");
    }

    lines.push("- TEMUAN:");
    for (const finding of findings) {
      lines.push(`  - ${finding}`);
    }

    if (uniqueRecommendations.length > 0) {
      lines.push("- REKOMENDASI:");
      for (const recommendation of uniqueRecommendations) {
        lines.push(`  - ${recommendation}`);
      }
    }

    lines.push("- CATATAN: Skrining ini rule-based, wajib verifikasi klinis akhir.");

    return lines.join("\n");
  },
});
