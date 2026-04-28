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
}

interface OpenFdaResponse {
  results?: OpenFdaResult[];
}

const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, " ");

const quote = (value: string) => `\"${value.replace(/\"/g, "").trim()}\"`;

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
  return `${env.OPENFDA_API_BASE_URL}?search=${search}&limit=10${apiKeyPart}`;
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

    return results.map((item, index) => {
      const ndc = item.openfda?.package_ndc?.[0] ?? item.openfda?.product_ndc?.[0] ?? null;

      return {
        source: "openfda",
        sourceId: ndc ?? `${trimmed}-${index}`,
        name: item.openfda?.brand_name?.[0] ?? item.openfda?.generic_name?.[0] ?? "Unknown",
        genericName: item.openfda?.generic_name?.[0] ?? null,
        dosageForm: item.openfda?.dosage_form?.[0] ?? null,
        strength: item.openfda?.substance_name?.[0] ?? null,
        barcode: ndc,
      };
    });
  } catch (error) {
    console.error("OpenFDA search failed", error);
    return [];
  }
};
