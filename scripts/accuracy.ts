import { tokenizeForScoring } from "./f1.js";

export type AccuracyResult = {
  accuracy: number;
  exactMatch: boolean;
  matchedTokenCount: number;
  comparedTokenCount: number;
  expectedTokenCount: number;
  generatedTokenCount: number;
};

export function calculateTokenAccuracy(expectedAnswer: string, generatedAnswer: string): AccuracyResult {
  const expectedTokens = tokenizeForScoring(expectedAnswer);
  const generatedTokens = tokenizeForScoring(generatedAnswer);

  const expectedJoined = expectedTokens.join(" ");
  const generatedJoined = generatedTokens.join(" ");
  const exactMatch = expectedJoined === generatedJoined;

  const comparedTokenCount = Math.max(expectedTokens.length, generatedTokens.length);

  if (comparedTokenCount === 0) {
    return {
      accuracy: 1,
      exactMatch: true,
      matchedTokenCount: 0,
      comparedTokenCount: 0,
      expectedTokenCount: 0,
      generatedTokenCount: 0,
    };
  }

  const minLength = Math.min(expectedTokens.length, generatedTokens.length);
  let matchedTokenCount = 0;

  for (let i = 0; i < minLength; i += 1) {
    if (expectedTokens[i] === generatedTokens[i]) {
      matchedTokenCount += 1;
    }
  }

  const accuracy = matchedTokenCount / comparedTokenCount;

  return {
    accuracy,
    exactMatch,
    matchedTokenCount,
    comparedTokenCount,
    expectedTokenCount: expectedTokens.length,
    generatedTokenCount: generatedTokens.length,
  };
}