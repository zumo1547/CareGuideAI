import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractLikelyMedicineQuery, extractTextFromImageFallback } from "@/lib/scan/ocr";

const schema = z.object({
  patientId: z.uuid().optional(),
  extractedText: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const resolvedPatientId = parsed.data.patientId ?? auth.userId;
  if (auth.role === "patient" && resolvedPatientId !== auth.userId) {
    return forbidden("Patient can only scan for own account");
  }

  const ocrText = await extractTextFromImageFallback(parsed.data.extractedText);
  if (!ocrText) {
    return badRequest("No text found for OCR fallback");
  }

  const query = extractLikelyMedicineQuery(ocrText);
  if (!query) {
    return badRequest("Unable to derive medicine query from OCR text");
  }

  const supabase = await createSupabaseServerClient();
  const { data: localMedicines } = await supabase
    .from("medicines")
    .select("id, name, strength")
    .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%`)
    .limit(5);

  let matchedMedicine = localMedicines?.[0] ?? null;
  if (!matchedMedicine) {
    const fdaResults = await searchOpenFdaMedicines(query);
    const first = fdaResults[0];
    if (first) {
      const { data: inserted } = await supabase
        .from("medicines")
        .insert({
          external_source: first.source,
          external_id: first.sourceId,
          name: first.name,
          generic_name: first.genericName,
          dosage_form: first.dosageForm,
          strength: first.strength,
          barcode: first.barcode,
          created_by: auth.userId,
        })
        .select("id, name, strength")
        .single();
      matchedMedicine = inserted ?? null;
    }
  }

  await supabase.from("scan_sessions").insert({
    patient_id: resolvedPatientId,
    medicine_id: matchedMedicine?.id ?? null,
    guidance_state: matchedMedicine ? "hold_steady" : "move_closer",
    matched_via: "ocr",
    confidence: matchedMedicine ? 0.72 : 0.2,
    raw_payload: {
      ocrText,
      query,
    },
  });

  return NextResponse.json({
    guidance: matchedMedicine ? "hold_steady" : "move_closer",
    foundMedicine: Boolean(matchedMedicine),
    medicine: matchedMedicine,
    ocrText,
    query,
  });
}
