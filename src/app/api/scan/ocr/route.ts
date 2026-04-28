import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { resolveMedicationKnowledge } from "@/lib/medications/knowledge";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import {
  extractLikelyMedicineQuery,
  extractTextFromImageFallback,
  parseMedicationDetailsFromText,
  validateParsedMedicationDetails,
} from "@/lib/scan/ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MedicineSearchResult } from "@/types/domain";

const schema = z.object({
  patientId: z.uuid().optional(),
  extractedText: z.string().optional(),
});

const sanitizeForIlike = (value: string) => value.replace(/[,%()]/g, " ").trim();

const normalizeDrugText = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/\b(tablet|tablets|tab|capsule|capsules|cap|film|coated|mg|mcg|ml|g)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const isLikelyPatientThaiName = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)\s*[ก-๙]/.test(normalized)) return true;
  if (/(hn|opd|ผู้ป่วย|โรงพยาบาล|คลินิก)/i.test(normalized)) return true;
  return /^[ก-๙]{2,20}\s+[ก-๙]{2,30}$/.test(normalized);
};

const scoreNameMatch = (candidate: MedicineSearchResult, ...inputs: Array<string | null | undefined>) => {
  const candidateTokens = [
    ...normalizeDrugText(candidate.name).split(" "),
    ...normalizeDrugText(candidate.genericName).split(" "),
    ...normalizeDrugText(candidate.thaiName).split(" "),
  ].filter((token) => token.length >= 2);
  if (!candidateTokens.length) return 0;

  let best = 0;
  for (const input of inputs) {
    const normalizedInput = normalizeDrugText(input);
    if (!normalizedInput) continue;
    if (normalizedInput === normalizeDrugText(candidate.name)) {
      return 1;
    }

    if (
      normalizeDrugText(candidate.name).includes(normalizedInput) ||
      normalizeDrugText(candidate.genericName).includes(normalizedInput)
    ) {
      best = Math.max(best, 0.9);
    }

    const inputTokens = normalizedInput.split(" ").filter((token) => token.length >= 2);
    if (!inputTokens.length) continue;
    const overlap = inputTokens.filter((token) => candidateTokens.includes(token));
    if (overlap.length) {
      best = Math.max(best, overlap.length / Math.max(candidateTokens.length, inputTokens.length));
    }
  }

  return Number(best.toFixed(3));
};

interface LocalMedicineRow {
  id: string;
  name: string;
  strength: string | null;
  generic_name: string | null;
  dosage_form: string | null;
  external_source: string | null;
  external_id: string | null;
  barcode: string | null;
  instructions: string | null;
}

const toLocalCandidate = (row: LocalMedicineRow): MedicineSearchResult => {
  const knowledge = resolveMedicationKnowledge([row.name, row.generic_name]);
  return {
    id: row.id,
    source: "local",
    sourceId: row.external_id ?? row.id,
    name: row.name,
    genericName: row.generic_name,
    dosageForm: row.dosage_form,
    strength: row.strength,
    barcode: row.barcode,
    thaiName: knowledge?.thaiName ?? null,
    indicationEn: row.instructions,
    indicationTh: knowledge?.useTh ?? null,
    symptomTagsTh: knowledge?.symptomReliefTh ?? [],
  };
};

const createUsageSummaryTh = (candidate: MedicineSearchResult) => {
  const knowledge = resolveMedicationKnowledge([candidate.name, candidate.genericName, candidate.thaiName]);
  return {
    thaiName: candidate.thaiName ?? knowledge?.thaiName ?? null,
    useTh:
      candidate.indicationTh ??
      knowledge?.useTh ??
      "มีข้อมูลยาจากฐานข้อมูลภายนอก กรุณาอ่านฉลากและคำสั่งแพทย์ประกอบ",
    symptomTagsTh:
      (candidate.symptomTagsTh ?? []).length
        ? (candidate.symptomTagsTh ?? [])
        : (knowledge?.symptomReliefTh ?? []),
    indicationEn: candidate.indicationEn ?? null,
  };
};

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

  const parsedDetailsRaw = parseMedicationDetailsFromText(ocrText);
  const queryFromText = extractLikelyMedicineQuery(ocrText);
  const searchQuery =
    parsedDetailsRaw.medicineNameEn?.trim() ||
    parsedDetailsRaw.medicineQuery?.trim() ||
    queryFromText.trim();
  if (!searchQuery) {
    return badRequest("Unable to identify medicine query from OCR text");
  }

  const safeQuery = sanitizeForIlike(searchQuery);
  const supabase = await createSupabaseServerClient();
  const { data: localRows } = await supabase
    .from("medicines")
    .select(
      "id, name, strength, generic_name, dosage_form, external_source, external_id, barcode, instructions",
    )
    .or(`name.ilike.%${safeQuery}%,generic_name.ilike.%${safeQuery}%,barcode.ilike.%${safeQuery}%`)
    .limit(8);

  const localCandidates = (localRows ?? []).map((row) => toLocalCandidate(row as LocalMedicineRow));
  const externalCandidates = await searchOpenFdaMedicines(searchQuery);
  const mergedCandidates: MedicineSearchResult[] = [...localCandidates, ...externalCandidates];

  let chosenCandidate: MedicineSearchResult | null = null;
  let chosenScore = 0;
  for (const candidate of mergedCandidates) {
    const score = scoreNameMatch(
      candidate,
      searchQuery,
      parsedDetailsRaw.medicineNameEn,
      parsedDetailsRaw.medicineQuery,
      queryFromText,
    );
    if (score > chosenScore) {
      chosenScore = score;
      chosenCandidate = candidate;
    }
  }

  if (!chosenCandidate && mergedCandidates.length) {
    chosenCandidate = mergedCandidates[0];
    chosenScore = 0.45;
  }

  const usage = chosenCandidate ? createUsageSummaryTh(chosenCandidate) : null;
  const medicineNameThFromOcr = isLikelyPatientThaiName(parsedDetailsRaw.medicineNameTh)
    ? null
    : parsedDetailsRaw.medicineNameTh;

  const parsedDetails = {
    ...parsedDetailsRaw,
    medicineNameEn:
      chosenCandidate?.name ??
      chosenCandidate?.genericName ??
      parsedDetailsRaw.medicineNameEn,
    medicineNameTh:
      usage?.thaiName ??
      medicineNameThFromOcr ??
      parsedDetailsRaw.medicineNameTh,
    medicineQuery:
      chosenCandidate?.genericName ??
      chosenCandidate?.name ??
      parsedDetailsRaw.medicineQuery,
  };

  const validation = validateParsedMedicationDetails(parsedDetails);

  let matchedMedicine: { id: string; name: string; strength: string | null } | null = null;
  if (chosenCandidate) {
    if (chosenCandidate.source === "local" && chosenCandidate.id) {
      matchedMedicine = {
        id: chosenCandidate.id,
        name: chosenCandidate.name,
        strength: chosenCandidate.strength ?? null,
      };
    } else if (chosenCandidate.source === "openfda") {
      const sourceId = chosenCandidate.sourceId;
      let existing: { id: string; name: string; strength: string | null } | null = null;
      if (sourceId) {
        const { data } = await supabase
          .from("medicines")
          .select("id, name, strength")
          .eq("external_source", "openfda")
          .eq("external_id", sourceId)
          .maybeSingle();
        existing = data ?? null;
      }

      if (existing) {
        matchedMedicine = existing;
      } else {
        const { data: inserted } = await supabase
          .from("medicines")
          .insert({
            external_source: "openfda",
            external_id: sourceId || null,
            name: chosenCandidate.name,
            generic_name: chosenCandidate.genericName,
            dosage_form: chosenCandidate.dosageForm,
            strength: chosenCandidate.strength,
            barcode: chosenCandidate.barcode,
            instructions: chosenCandidate.indicationEn ?? usage?.useTh ?? null,
            created_by: auth.userId,
          })
          .select("id, name, strength")
          .single();
        matchedMedicine = inserted ?? null;
      }
    }
  }

  const hasDoseSignal =
    Boolean(parsedDetails.quantityPerDose) ||
    Boolean(parsedDetails.frequencyPerDay) ||
    parsedDetails.periods.length > 0 ||
    parsedDetails.customTimes.length > 0 ||
    parsedDetails.mealTiming !== "unspecified";
  const hasStrongCatalogMatch = Boolean(chosenCandidate) && chosenScore >= 0.52;
  const effectiveCanConfirm = validation.canConfirm || (hasStrongCatalogMatch && hasDoseSignal);
  const effectiveValidation = effectiveCanConfirm
    ? {
        ...validation,
        canConfirm: true,
        score: Math.max(validation.score, hasStrongCatalogMatch ? 0.7 : validation.score),
        messageTh: validation.canConfirm
          ? validation.messageTh
          : "พบชื่อยาตรงกับฐานข้อมูลภายนอกและวิธีใช้ยาแล้ว สามารถยืนยันได้",
      }
    : validation;

  const effectiveMedicine = effectiveCanConfirm ? matchedMedicine : null;
  const effectiveConfidence = effectiveCanConfirm
    ? Math.max(0.72, parsedDetails.confidence)
    : Math.min(parsedDetails.confidence, validation.score);

  await supabase.from("scan_sessions").insert({
    patient_id: resolvedPatientId,
    medicine_id: effectiveMedicine?.id ?? null,
    guidance_state: "hold_steady",
    matched_via: "ocr",
    confidence: effectiveConfidence,
    raw_payload: {
      ocrText,
      query: searchQuery,
      parsedDetails,
      validation: effectiveValidation,
      catalogMatch: chosenCandidate,
      catalogScore: chosenScore,
      usage,
    },
  });

  return NextResponse.json({
    guidance: effectiveCanConfirm ? "hold_steady" : "move_closer",
    foundMedicine: Boolean(effectiveMedicine),
    medicine: effectiveMedicine,
    ocrText,
    query: searchQuery,
    parsedDetails,
    validation: effectiveValidation,
    externalInfo: chosenCandidate
      ? {
          source: chosenCandidate.source,
          matchedNameEn: chosenCandidate.name,
          matchedNameTh: usage?.thaiName ?? null,
          genericNameEn: chosenCandidate.genericName ?? null,
          indicationEn: usage?.indicationEn ?? null,
          indicationTh: usage?.useTh ?? null,
          symptomTagsTh: usage?.symptomTagsTh ?? [],
          matchScore: chosenScore,
        }
      : null,
  });
}
