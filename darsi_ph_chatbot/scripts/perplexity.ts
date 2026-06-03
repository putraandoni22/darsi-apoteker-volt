import { tokenizeForScoring } from "./f1.js";

export type PerplexityResult = {
  perplexity: number;
  crossEntropy: number;
  tokenCount: number;
  nGramSize: number;
  smoothing: number;
};

type NGramModel = {
  nGramCounts: Map<string, number>;
  contextCounts: Map<string, number>;
  vocabularySize: number;
};

const START_TOKEN = "<s>";
const END_TOKEN = "</s>";

function withBoundaries(tokens: string[], nGramSize: number): string[] {
  const starts = Array.from({ length: Math.max(0, nGramSize - 1) }, () => START_TOKEN);
  return [...starts, ...tokens, END_TOKEN];
}

function buildModel(referenceTokens: string[], nGramSize: number, evaluationTokens: string[]): NGramModel {
  const nGramCounts = new Map<string, number>();
  const contextCounts = new Map<string, number>();
  const referenceSequence = withBoundaries(referenceTokens, nGramSize);
  const vocabulary = new Set<string>([...referenceTokens, ...evaluationTokens, END_TOKEN]);

  for (let i = nGramSize - 1; i < referenceSequence.length; i += 1) {
    const context = referenceSequence.slice(i - (nGramSize - 1), i).join(" ");
    const token = referenceSequence[i];
    const nGramKey = `${context}|||${token}`;

    nGramCounts.set(nGramKey, (nGramCounts.get(nGramKey) ?? 0) + 1);
    contextCounts.set(context, (contextCounts.get(context) ?? 0) + 1);
  }

  return {
    nGramCounts,
    contextCounts,
    vocabularySize: Math.max(vocabulary.size, 1),
  };
}

export function calculatePseudoPerplexity(
  generatedAnswer: string,
  referenceAnswer: string,
  nGramSize = 2,
  smoothing = 1,
): PerplexityResult {
  const safeNGramSize = Math.max(2, Math.floor(nGramSize));
  const safeSmoothing = Math.max(1e-6, smoothing);

  const generatedTokens = tokenizeForScoring(generatedAnswer);
  const referenceTokens = tokenizeForScoring(referenceAnswer);

  if (generatedTokens.length === 0) {
    return {
      perplexity: 1,
      crossEntropy: 0,
      tokenCount: 0,
      nGramSize: safeNGramSize,
      smoothing: safeSmoothing,
    };
  }

  const fallbackReference = referenceTokens.length > 0 ? referenceTokens : generatedTokens;
  const model = buildModel(fallbackReference, safeNGramSize, generatedTokens);
  const evaluationSequence = withBoundaries(generatedTokens, safeNGramSize);

  let totalLogProbability = 0;
  let predictedTokenCount = 0;

  for (let i = safeNGramSize - 1; i < evaluationSequence.length; i += 1) {
    const context = evaluationSequence.slice(i - (safeNGramSize - 1), i).join(" ");
    const token = evaluationSequence[i];
    const nGramKey = `${context}|||${token}`;

    const nGramCount = model.nGramCounts.get(nGramKey) ?? 0;
    const contextCount = model.contextCounts.get(context) ?? 0;
    const probability =
      (nGramCount + safeSmoothing) /
      (contextCount + safeSmoothing * model.vocabularySize);

    totalLogProbability += Math.log2(probability);
    predictedTokenCount += 1;
  }

  const crossEntropy = -(totalLogProbability / Math.max(1, predictedTokenCount));
  const perplexity = 2 ** crossEntropy;

  return {
    perplexity,
    crossEntropy,
    tokenCount: predictedTokenCount,
    nGramSize: safeNGramSize,
    smoothing: safeSmoothing,
  };
}