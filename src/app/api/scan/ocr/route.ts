import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractLikelyMedicineQuery,
  extractTextFromImageFallback,
  parseMedicationDetailsFromText,
  validateParsedMedicationDetails,
} from "@/lib/scan/ocr";

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

  const parsedDetails = parseMedicationDetailsFromText(ocrText);
  const validation = validateParsedMedicationDetails(parsedDetails);
  const query = extractLikelyMedicineQuery(ocrText);

  const supabase = await createSupabaseServerClient();
  const { data: localMedicines } = query
    ? await supabase
        .from("medicines")
        .select("id, name, strength")
        .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%`)
        .limit(5)
    : { data: [] as { id: string; name: string; strength: string | null }[] };

  let matchedMedicine = localMedicines?.[0] ?? null;
  if (!matchedMedicine && query) {
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

  const hasDoseSignal =
    Boolean(parsedDetails.quantityPerDose) ||
    Boolean(parsedDetails.frequencyPerDay) ||
    parsedDetails.periods.length > 0 ||
    parsedDetails.customTimes.length > 0 ||
    parsedDetails.mealTiming !== "unspecified";
  const hasStrongCatalogMatch =
    Boolean(matchedMedicine) && query.trim().length >= 4 && parsedDetails.confidence >= 0.55;
  const effectiveCanConfirm = validation.canConfirm || (hasStrongCatalogMatch && hasDoseSignal);
  const effectiveValidation = effectiveCanConfirm
    ? {
        ...validation,
        canConfirm: true,
        score: Math.max(validation.score, hasStrongCatalogMatch ? 0.62 : validation.score),
        messageTh: validation.canConfirm
          ? validation.messageTh
          : "ตรวจพบชื่อยาตรงฐานข้อมูลและวิธีใช้ยาแล้ว สามารถยืนยันได้",
      }
    : validation;

  const effectiveMedicine = effectiveCanConfirm ? matchedMedicine : null;
  const effectiveConfidence = effectiveCanConfirm
    ? matchedMedicine
      ? Math.max(0.72, parsedDetails.confidence)
      : parsedDetails.confidence
    : Math.min(parsedDetails.confidence, validation.score);

  await supabase.from("scan_sessions").insert({
    patient_id: resolvedPatientId,
    medicine_id: effectiveMedicine?.id ?? null,
    guidance_state: "hold_steady",
    matched_via: "ocr",
    confidence: effectiveConfidence,
    raw_payload: {
      ocrText,
      query,
      parsedDetails,
      validation: effectiveValidation,
    },
  });

  return NextResponse.json({
    guidance: effectiveCanConfirm ? "hold_steady" : "move_closer",
    foundMedicine: Boolean(effectiveMedicine),
    medicine: effectiveMedicine,
    ocrText,
    query,
    parsedDetails,
    validation: effectiveValidation,
  });
}
