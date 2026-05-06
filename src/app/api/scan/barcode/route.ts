import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { computeScanGuidance } from "@/lib/scan/guidance";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  patientId: z.uuid().optional(),
  barcode: z.string().min(2),
  frame: z
    .object({
      frameWidth: z.number().positive(),
      frameHeight: z.number().positive(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { patientId, barcode, frame } = parsed.data;
  const resolvedPatientId = patientId ?? auth.userId;
  const supabase = await createSupabaseServerClient();
  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId: resolvedPatientId,
  });
  if (!canAccess) {
    return forbidden("Cannot scan for this patient");
  }
  const guidance = computeScanGuidance(frame);

  let medicineId: string | null = null;
  let medicine: { id: string; name: string; strength: string | null } | null = null;

  const { data: localMedicine } = await supabase
    .from("medicines")
    .select("id, name, strength")
    .or(`barcode.eq.${barcode},external_id.eq.${barcode}`)
    .maybeSingle();

  if (localMedicine) {
    medicine = localMedicine;
    medicineId = localMedicine.id;
  } else {
    const fdaResults = await searchOpenFdaMedicines(barcode);
    const first = fdaResults[0];

    if (first) {
      const { data: created } = await supabase
        .from("medicines")
        .insert({
          external_source: first.source,
          external_id: first.sourceId,
          name: first.name,
          generic_name: first.genericName,
          dosage_form: first.dosageForm,
          strength: first.strength,
          barcode,
          created_by: auth.userId,
        })
        .select("id, name, strength")
        .single();

      if (created) {
        medicine = created;
        medicineId = created.id;
      }
    }
  }

  await supabase.from("scan_sessions").insert({
    patient_id: resolvedPatientId,
    medicine_id: medicineId,
    guidance_state: guidance,
    matched_via: "barcode",
    confidence: medicine ? 0.95 : 0.2,
    raw_payload: {
      barcode,
      frame,
      foundMedicine: Boolean(medicine),
    },
  });

  return NextResponse.json({
    scannedBarcode: barcode,
    barcodeDetected: true,
    matchStatus: medicine ? "matched" : "detected_only",
    guidance,
    foundMedicine: Boolean(medicine),
    medicine,
  });
}
