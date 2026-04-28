import { summarizeIndicationFromExternal, resolveMedicationKnowledge } from "@/lib/medications/knowledge";
import { env } from "@/lib/env";
import type { MedicineSearchResult } from "@/types/domain";

interface OpenFdaResult {
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    product_ndc?: string[];
    package_ndc?: string[];
    dosage_form?: string[];
    route?: string[];
    substance_name?: string[];
  };
  indications_and_usage?: string[];
  purpose?: string[];
}

interface OpenFdaResponse {
  results?: OpenFdaResult[];
}

const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, " ");

const quote = (value: string) => `\"${value.replace(/\"/g, "").trim()}\"`;

const normalizeForCompare = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitTokens = (value: string) =>
  normalizeForCompare(value)
    .split(" ")
    .filter((token) => token.length >= 2);

const scoreNameMatch = (query: string, ...candidates: Array<string | null | undefined>) => {
  const normalizedQuery = normalizeForCompare(query);
  if (!normalizedQuery) return 0;

  const queryTokens = splitTokens(normalizedQuery);
  let best = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedCandidate = normalizeForCompare(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedCandidate === normalizedQuery) return 1;
    if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
      best = Math.max(best, 0.88);
    }

    const candidateTokens = splitTokens(normalizedCandidate);
    const overlap = queryTokens.filter((token) => candidateTokens.includes(token));
    const overlapScore =
      overlap.length === 0
        ? 0
        : overlap.length / Math.max(1, Math.max(queryTokens.length, candidateTokens.length));
    best = Math.max(best, overlapScore);
  }
  return Number(best.toFixed(3));
};

const makeOpenFdaUrl = (query: string) => {
  const trimmed = normalizeQuery(query);
  const isLikelyCode = /^[\d-]+$/.test(trimmed);

  const searchTerms = [
    `openfda.brand_name:${quote(trimmed)}`,
    `openfda.generic_name:${quote(trimmed)}`,
    `openfda.substance_name:${quote(trimmed)}`,
  ];

  if (isLikelyCode) {
    searchTerms.unshift(
      `openfda.package_ndc:${quote(trimmed)}`,
      `openfda.product_ndc:${quote(trimmed)}`,
    );
  }

  const search = encodeURIComponent(searchTerms.join(" OR "));
  const apiKeyPart = env.OPENFDA_API_KEY ? `&api_key=${env.OPENFDA_API_KEY}` : "";
  return `${env.OPENFDA_API_BASE_URL}?search=${search}&limit=12${apiKeyPart}`;
};

const cleanText = (value: string | null | undefined, maxLength = 380) => {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
};

export const searchOpenFdaMedicines = async (
  query: string,
): Promise<MedicineSearchResult[]> => {
  const trimmed = normalizeQuery(query);
  if (!trimmed) {
    return [];
  }

  try {
    const response = await fetch(makeOpenFdaUrl(trimmed), {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as OpenFdaResponse;
    const results = payload.results ?? [];

    const mapped = results.map((item, index) => {
      const ndc = item.openfda?.package_ndc?.[0] ?? item.openfda?.product_ndc?.[0] ?? null;
      const brandName = item.openfda?.brand_name?.[0] ?? null;
      const genericName = item.openfda?.generic_name?.[0] ?? null;
      const name = brandName ?? genericName ?? "Unknown";
      const indicationEn = cleanText(item.indications_and_usage?.[0] ?? item.purpose?.[0] ?? null);
      const knowledge = resolveMedicationKnowledge([brandName, genericName, name]);
      const externalIndication = summarizeIndicationFromExternal(indicationEn);

      return {
        source: "openfda" as const,
        sourceId: ndc ?? `${trimmed}-${index}`,
        name,
        genericName,
        thaiName: knowledge?.thaiName ?? null,
        dosageForm: item.openfda?.dosage_form?.[0] ?? null,
        strength: item.openfda?.substance_name?.[0] ?? null,
        barcode: ndc,
        indicationEn,
        indicationTh:
          knowledge?.useTh ??
          externalIndication.indicationTh ??
          "มีข้อมูลยาจากฐานข้อมูลภายนอก แต่ไม่พบคำอธิบายภาษาไทยแบบเจาะจง",
        symptomTagsTh:
          knowledge?.symptomReliefTh.length
            ? knowledge.symptomReliefTh
            : externalIndication.symptomTagsTh,
      } satisfies MedicineSearchResult;
    });

    return mapped
      .sort((a, b) => {
        const scoreA = scoreNameMatch(trimmed, a.name, a.genericName, a.thaiName);
        const scoreB = scoreNameMatch(trimmed, b.name, b.genericName, b.thaiName);
        return scoreB - scoreA;
      })
      .slice(0, 10);
  } catch (error) {
    console.error("OpenFDA search failed", error);
    return [];
  }
};
