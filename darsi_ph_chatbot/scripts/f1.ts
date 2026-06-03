export type F1ScoreResult = {
  precision: number;
  recall: number;
  f1: number;
  overlapCount: number;
  generatedTokenCount: number;
  expectedTokenCount: number;
};

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\s./-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForScoring(input: string): string[] {
  const normalized = normalizeText(input);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter(Boolean);
}

function frequencyMap(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function countOverlap(expectedTokens: string[], generatedTokens: string[]): number {
  const expectedFreq = frequencyMap(expectedTokens);
  const generatedFreq = frequencyMap(generatedTokens);

  let overlap = 0;
  for (const [token, expectedCount] of expectedFreq.entries()) {
    const generatedCount = generatedFreq.get(token) ?? 0;
    overlap += Math.min(expectedCount, generatedCount);
  }
  return overlap;
}

export function calculateTokenF1(expectedAnswer: string, generatedAnswer: string): F1ScoreResult {
  const expectedTokens = tokenizeForScoring(expectedAnswer);
  const generatedTokens = tokenizeForScoring(generatedAnswer);

  if (expectedTokens.length === 0 && generatedTokens.length === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      overlapCount: 0,
      generatedTokenCount: 0,
      expectedTokenCount: 0,
    };
  }

  if (expectedTokens.length === 0 || generatedTokens.length === 0) {
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      overlapCount: 0,
      generatedTokenCount: generatedTokens.length,
      expectedTokenCount: expectedTokens.length,
    };
  }

  const overlap = countOverlap(expectedTokens, generatedTokens);
  const precision = overlap / generatedTokens.length;
  const recall = overlap / expectedTokens.length;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision,
    recall,
    f1,
    overlapCount: overlap,
    generatedTokenCount: generatedTokens.length,
    expectedTokenCount: expectedTokens.length,
  };
}