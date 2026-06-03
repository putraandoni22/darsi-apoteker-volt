import * as fs from "fs";
import * as path from "path";

export type UserMode = "pasien" | "apoteker";

export interface CuratedFaqEntry {
  id: string;
  keywords: string[];
  answerPasien: string;
  answerApoteker: string;
  source?: string;
}

let cachedFaq: CuratedFaqEntry[] | null = null;

function loadFaq(): CuratedFaqEntry[] {
  if (cachedFaq) {
    return cachedFaq;
  }

  const filePath = path.join(process.cwd(), "data", "faq_apoteker_curated.json");
  if (!fs.existsSync(filePath)) {
    cachedFaq = [];
    return cachedFaq;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as CuratedFaqEntry[];
    cachedFaq = Array.isArray(parsed)
      ? parsed.filter((item) => item && item.id && Array.isArray(item.keywords))
      : [];
  } catch {
    cachedFaq = [];
  }

  return cachedFaq;
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchCuratedFaq(input: string, userMode: UserMode): { id: string; answer: string; source: string } | null {
  const normalized = normalizeText(input);
  if (!normalized) {
    return null;
  }

  const entries = loadFaq();
  if (entries.length === 0) {
    return null;
  }

  let best: CuratedFaqEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    const keywords = entry.keywords.map((k) => normalizeText(k)).filter(Boolean);
    if (keywords.length === 0) {
      continue;
    }

    let score = 0;
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (!best) {
    return null;
  }

  const threshold = best.keywords.length >= 4 ? 2 : 1;
  if (bestScore < threshold) {
    return null;
  }

  return {
    id: best.id,
    answer: userMode === "apoteker" ? best.answerApoteker : best.answerPasien,
    source: best.source || "CURATED_FAQ",
  };
}
