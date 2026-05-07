import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { env } from "@/lib/env";
import { getBmiTrend, type BiologicalSex } from "@/lib/onboarding";
import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";
import {
  assessBloodPressure,
  buildBmiLinkedBloodPressureSummary,
  parseBloodPressureFromText,
  type ParsedBloodPressureReading,
} from "@/lib/scan/blood-pressure";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PostgrestErrorLike = { message?: string; code?: string | null } | null | undefined;

const sourceSchema = z.enum(["ocr_camera", "ocr_upload", "manual"]);

const postSchema = z.object({
  patientId: z.uuid().optional(),
  extractedText: z.string().optional(),
  systolic: z.number().int().min(70).max(260).optional(),
  diastolic: z.number().int().min(40).max(160).optional(),
  pulse: z.number().int().min(35).max(220).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  capturedAt: z.string().datetime().optional(),
  source: sourceSchema.optional(),
});

const SYS_MIN = 70;
const SYS_MAX = 260;
const DIA_MIN = 40;
const DIA_MAX = 160;
const PULSE_MIN = 35;
const PULSE_MAX = 220;

const isInRange = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

const hasPlausiblePair = (systolic: number, diastolic: number) =>
  systolic > diastolic && systolic - diastolic >= 8 && systolic - diastolic <= 130;

const isBloodPressureSchemaError = (error: PostgrestErrorLike) => {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return message.includes("blood_pressure_readings") && isSchemaCacheMissingError({
    message: error.message,
    code: error.code ?? null,
  });
};

const shouldRetryWithSessionClient = (error: PostgrestErrorLike) => {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("jwt") ||
    message.includes("permission denied") ||
    message.includes("not authorized") ||
    message.includes("invalid api key")
  );
};

const normalizePulse = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  return isInRange(value, PULSE_MIN, PULSE_MAX) ? value : null;
};

const readingFromManualInput = (payload: z.infer<typeof postSchema>): ParsedBloodPressureReading | null => {
  if (!payload.systolic || !payload.diastolic) return null;
  if (!isInRange(payload.systolic, SYS_MIN, SYS_MAX)) return null;
  if (!isInRange(payload.diastolic, DIA_MIN, DIA_MAX)) return null;
  if (!hasPlausiblePair(payload.systolic, payload.diastolic)) return null;

  return {
    systolic: payload.systolic,
    diastolic: payload.diastolic,
    pulse: normalizePulse(payload.pulse),
    confidence: Math.max(0.4, Math.min(0.95, payload.confidence ?? 0.72)),
    source: "pair",
    rawText: payload.extractedText ?? "",
    normalizedText: payload.extractedText ?? "",
  };
};

const serializeReading = (record: {
  id: string;
  measured_at: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category: string;
  category_label_th: string;
  trend_summary_th: string;
  bmi_at_measurement: number | null;
  bmi_trend_label: string | null;
  source: string;
  ocr_confidence: number | null;
}) => ({
  id: record.id,
  measuredAt: record.measured_at,
  systolic: record.systolic,
  diastolic: record.diastolic,
  pulse: record.pulse,
  category: record.category,
  categoryLabelTh: record.category_label_th,
  trendSummaryTh: record.trend_summary_th,
  bmiAtMeasurement: record.bmi_at_measurement,
  bmiTrendLabel: record.bmi_trend_label,
  source: record.source,
  ocrConfidence: record.ocr_confidence,
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = postSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const patientId = payload.patientId ?? auth.userId;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : null;
  const writer = adminSupabase ?? supabase;
  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot save blood pressure for this patient");
  }

  const ocrReading = payload.extractedText ? parseBloodPressureFromText(payload.extractedText) : null;
  const manualReading = readingFromManualInput(payload);
  const reading = ocrReading ?? manualReading;

  if (!reading) {
    return badRequest("Cannot parse blood pressure from OCR/manual input");
  }

  const assessment = assessBloodPressure(reading.systolic, reading.diastolic);

  let onboardingResult = await writer
    .from("user_onboarding_profiles")
    .select("biological_sex, bmi")
    .eq("user_id", patientId)
    .maybeSingle();
  if (adminSupabase && shouldRetryWithSessionClient(onboardingResult.error)) {
    onboardingResult = await supabase
      .from("user_onboarding_profiles")
      .select("biological_sex, bmi")
      .eq("user_id", patientId)
      .maybeSingle();
  }
  const onboardingProfile = onboardingResult.data ?? null;

  const biologicalSex = onboardingProfile?.biological_sex as BiologicalSex | null;
  const bmiValue = Number(onboardingProfile?.bmi ?? 0);
  const bmiTrend =
    biologicalSex && Number.isFinite(bmiValue) && bmiValue > 0
      ? getBmiTrend(bmiValue, biologicalSex)
      : null;
  const trendSummaryTh = buildBmiLinkedBloodPressureSummary(assessment, bmiTrend);

  const measuredAt =
    payload.capturedAt && Number.isFinite(new Date(payload.capturedAt).getTime())
      ? new Date(payload.capturedAt).toISOString()
      : new Date().toISOString();

  const insertPayload = {
    patient_id: patientId,
    measured_at: measuredAt,
    systolic: reading.systolic,
    diastolic: reading.diastolic,
    pulse: normalizePulse(reading.pulse),
    source: payload.source ?? "ocr_camera",
    ocr_confidence: Number(reading.confidence.toFixed(3)),
    ocr_text: payload.extractedText?.trim() || reading.rawText || null,
    category: assessment.category,
    category_label_th: assessment.categoryLabelTh,
    trend_summary_th: trendSummaryTh,
    bmi_at_measurement: bmiTrend ? bmiTrend.bmi : null,
    bmi_trend_label: bmiTrend?.bloodPressureTrendLabel ?? null,
    raw_payload: {
      source: payload.source ?? "ocr_camera",
      reading,
      assessment,
      bmiTrend,
      capturedAt: measuredAt,
    },
    created_by: auth.userId,
  };

  let storage: "blood_pressure_readings" | "scan_sessions_fallback" = "blood_pressure_readings";
  let responseReading = null as
    | ReturnType<typeof serializeReading>
    | {
        id: string;
        measuredAt: string;
        systolic: number;
        diastolic: number;
        pulse: number | null;
        category: string;
        categoryLabelTh: string;
        trendSummaryTh: string;
        bmiAtMeasurement: number | null;
        bmiTrendLabel: string | null;
        source: string;
        ocrConfidence: number | null;
      }
    | null;

  {
    let inserted = await writer
      .from("blood_pressure_readings")
      .insert(insertPayload)
      .select(
        "id, measured_at, systolic, diastolic, pulse, category, category_label_th, trend_summary_th, bmi_at_measurement, bmi_trend_label, source, ocr_confidence",
      )
      .single();
    if (adminSupabase && shouldRetryWithSessionClient(inserted.error)) {
      inserted = await supabase
        .from("blood_pressure_readings")
        .insert(insertPayload)
        .select(
          "id, measured_at, systolic, diastolic, pulse, category, category_label_th, trend_summary_th, bmi_at_measurement, bmi_trend_label, source, ocr_confidence",
        )
        .single();
    }

    if (!inserted.error && inserted.data) {
      responseReading = serializeReading(inserted.data);
    } else if (isBloodPressureSchemaError(inserted.error)) {
      storage = "scan_sessions_fallback";
      let fallbackInsert = await writer.from("scan_sessions").insert({
        patient_id: patientId,
        medicine_id: null,
        guidance_state: "hold_steady",
        matched_via: "ocr",
        confidence: Number(reading.confidence.toFixed(3)),
        raw_payload: {
          kind: "blood_pressure",
          measuredAt,
          reading,
          assessment,
          trendSummaryTh,
          bmiTrend,
          source: payload.source ?? "ocr_camera",
        },
      });
      if (adminSupabase && shouldRetryWithSessionClient(fallbackInsert.error)) {
        fallbackInsert = await supabase.from("scan_sessions").insert({
          patient_id: patientId,
          medicine_id: null,
          guidance_state: "hold_steady",
          matched_via: "ocr",
          confidence: Number(reading.confidence.toFixed(3)),
          raw_payload: {
            kind: "blood_pressure",
            measuredAt,
            reading,
            assessment,
            trendSummaryTh,
            bmiTrend,
            source: payload.source ?? "ocr_camera",
          },
        });
      }

      if (fallbackInsert.error) {
        return NextResponse.json(
          { error: `Cannot save blood pressure reading: ${fallbackInsert.error.message}` },
          { status: 400 },
        );
      }

      responseReading = {
        id: `fallback-${Date.now()}`,
        measuredAt,
        systolic: reading.systolic,
        diastolic: reading.diastolic,
        pulse: normalizePulse(reading.pulse),
        category: assessment.category,
        categoryLabelTh: assessment.categoryLabelTh,
        trendSummaryTh,
        bmiAtMeasurement: bmiTrend?.bmi ?? null,
        bmiTrendLabel: bmiTrend?.bloodPressureTrendLabel ?? null,
        source: payload.source ?? "ocr_camera",
        ocrConfidence: Number(reading.confidence.toFixed(3)),
      };
    } else {
      return NextResponse.json(
        { error: inserted.error?.message ?? "Cannot save blood pressure reading" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    reading: responseReading,
    assessment,
    bmiTrend,
    storage,
  });
}

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { searchParams } = new URL(request.url);
  const patientIdParam = searchParams.get("patientId");
  const patientId = patientIdParam || auth.userId;

  const supabase = await createSupabaseServerClient();
  const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : null;
  const reader = adminSupabase ?? supabase;
  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot read blood pressure for this patient");
  }

  let listQuery = await reader
    .from("blood_pressure_readings")
    .select(
      "id, measured_at, systolic, diastolic, pulse, category, category_label_th, trend_summary_th, bmi_at_measurement, bmi_trend_label, source, ocr_confidence",
    )
    .eq("patient_id", patientId)
    .order("measured_at", { ascending: false })
    .limit(20);
  if (adminSupabase && shouldRetryWithSessionClient(listQuery.error)) {
    listQuery = await supabase
      .from("blood_pressure_readings")
      .select(
        "id, measured_at, systolic, diastolic, pulse, category, category_label_th, trend_summary_th, bmi_at_measurement, bmi_trend_label, source, ocr_confidence",
      )
      .eq("patient_id", patientId)
      .order("measured_at", { ascending: false })
      .limit(20);
  }

  if (!listQuery.error) {
    return NextResponse.json({
      readings: (listQuery.data ?? []).map((row) => serializeReading(row)),
      storage: "blood_pressure_readings",
    });
  }

  if (!isBloodPressureSchemaError(listQuery.error)) {
    return NextResponse.json({ error: listQuery.error.message }, { status: 400 });
  }

  let fallback = await reader
    .from("scan_sessions")
    .select("id, confidence, raw_payload, created_at")
    .eq("patient_id", patientId)
    .contains("raw_payload", { kind: "blood_pressure" })
    .order("created_at", { ascending: false })
    .limit(20);
  if (adminSupabase && shouldRetryWithSessionClient(fallback.error)) {
    fallback = await supabase
      .from("scan_sessions")
      .select("id, confidence, raw_payload, created_at")
      .eq("patient_id", patientId)
      .contains("raw_payload", { kind: "blood_pressure" })
      .order("created_at", { ascending: false })
      .limit(20);
  }

  if (fallback.error) {
    return NextResponse.json({ error: fallback.error.message }, { status: 400 });
  }

  const readings = (fallback.data ?? [])
    .map((item) => {
      const payload = (item.raw_payload ?? {}) as {
        measuredAt?: string;
        reading?: { systolic?: number; diastolic?: number; pulse?: number | null };
        assessment?: { category?: string; categoryLabelTh?: string };
        trendSummaryTh?: string;
        bmiTrend?: { bmi?: number; bloodPressureTrendLabel?: string };
        source?: string;
      };

      const systolic = Number(payload.reading?.systolic ?? 0);
      const diastolic = Number(payload.reading?.diastolic ?? 0);
      if (!isInRange(systolic, SYS_MIN, SYS_MAX) || !isInRange(diastolic, DIA_MIN, DIA_MAX)) {
        return null;
      }

      return {
        id: item.id,
        measuredAt: payload.measuredAt ?? item.created_at,
        systolic,
        diastolic,
        pulse: normalizePulse(payload.reading?.pulse ?? null),
        category: payload.assessment?.category ?? "normal",
        categoryLabelTh: payload.assessment?.categoryLabelTh ?? "ไม่ระบุ",
        trendSummaryTh: payload.trendSummaryTh ?? "-",
        bmiAtMeasurement:
          payload.bmiTrend?.bmi && Number.isFinite(Number(payload.bmiTrend.bmi))
            ? Number(payload.bmiTrend.bmi)
            : null,
        bmiTrendLabel: payload.bmiTrend?.bloodPressureTrendLabel ?? null,
        source: payload.source ?? "ocr_camera",
        ocrConfidence: item.confidence ? Number(item.confidence) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return NextResponse.json({
    readings,
    storage: "scan_sessions_fallback",
  });
}
