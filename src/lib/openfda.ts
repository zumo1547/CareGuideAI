import { env } from "@/lib/env";
import type { MedicineSearchResult } from "@/types/domain";

interface OpenFdaResult {
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    product_ndc?: string[];
    dosage_form?: string[];
    route?: string[];
    substance_name?: string[];
  };
  indications_and_usage?: string[];
}

interface OpenFdaResponse {
  results?: OpenFdaResult[];
}

const makeOpenFdaUrl = (query: string) => {
  const trimmed = query.trim();
  const encoded = encodeURIComponent(trimmed);

  const search = [
    `openfda.brand_name:${encoded}`,
    `openfda.generic_name:${encoded}`,
    `openfda.substance_name:${encoded}`,
  ].join("+OR+");

  const apiKeyPart = env.OPENFDA_API_KEY ? `&api_key=${env.OPENFDA_API_KEY}` : "";
  return `${env.OPENFDA_API_BASE_URL}?search=${search}&limit=10${apiKeyPart}`;
};

export const searchOpenFdaMedicines = async (
  query: string,
): Promise<MedicineSearchResult[]> => {
  if (!query.trim()) {
    return [];
  }

  try {
    const response = await fetch(makeOpenFdaUrl(query), {
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

    return results.map((item, index) => ({
      source: "openfda",
      sourceId: item.openfda?.product_ndc?.[0] ?? `${query}-${index}`,
      name: item.openfda?.brand_name?.[0] ?? item.openfda?.generic_name?.[0] ?? "Unknown",
      genericName: item.openfda?.generic_name?.[0] ?? null,
      dosageForm: item.openfda?.dosage_form?.[0] ?? null,
      strength: item.openfda?.substance_name?.[0] ?? null,
      barcode: item.openfda?.product_ndc?.[0] ?? null,
    }));
  } catch (error) {
    console.error("OpenFDA search failed", error);
    return [];
  }
};
