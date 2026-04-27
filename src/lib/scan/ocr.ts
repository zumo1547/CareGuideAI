const normalizeText = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const extractLikelyMedicineQuery = (inputText: string) => {
  const normalized = normalizeText(inputText);
  if (!normalized) return "";

  const tokens = normalized.split(" ").filter((token) => token.length >= 3);
  return tokens.slice(0, 4).join(" ");
};

export const extractTextFromImageFallback = async (
  providedText: string | null | undefined,
) => {
  if (providedText && providedText.trim()) {
    return providedText.trim();
  }

  return "";
};
