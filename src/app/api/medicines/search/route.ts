import { NextResponse } from "next/server";

import { getApiAuthContext } from "@/lib/api/auth-helpers";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MedicineSearchResult } from "@/types/domain";

const sanitizeForIlike = (value: string) => value.replace(/[,'()]/g, " ").trim();

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({ data: [] });
  }

  const safeQuery = sanitizeForIlike(query);
  const supabase = await createSupabaseServerClient();
  const { data: local } = await supabase
    .from("medicines")
    .select("id, external_source, external_id, name, generic_name, dosage_form, strength, barcode")
    .or(
      `name.ilike.%${safeQuery}%,generic_name.ilike.%${safeQuery}%,barcode.ilike.%${safeQuery}%`,
    )
    .limit(12);

  const localMapped: MedicineSearchResult[] = (local ?? []).map((item) => ({
    id: item.id,
    source: "local",
    sourceId: item.external_id ?? item.id,
    name: item.name,
    genericName: item.generic_name,
    dosageForm: item.dosage_form,
    strength: item.strength,
    barcode: item.barcode,
  }));

  const remote = await searchOpenFdaMedicines(query);
  const unique = new Map<string, MedicineSearchResult>();
  [...localMapped, ...remote].forEach((item) => {
    if (!unique.has(item.sourceId)) {
      unique.set(item.sourceId, item);
    }
  });

  return NextResponse.json({ data: [...unique.values()].slice(0, 15) });
}
