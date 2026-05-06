import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { getCaregiverSchemaDiagnostics } from "@/lib/caregiver-schema-bootstrap";
import {
  CAREGIVER_SCHEMA_CACHE_MESSAGE,
  getSupabaseProjectRefFromEnv,
  isCaregiverSchemaCacheError,
} from "@/lib/caregiver-schema-errors";
import { withCaregiverSchemaRecovery } from "@/lib/caregiver-schema-retry";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createLinkSchema = z
  .object({
    caregiverId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    patientPhone: z.string().trim().min(6).max(40).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((value) => Boolean(value.patientId || value.patientPhone), {
    message: "patientId or patientPhone is required",
    path: ["patientId"],
  });

const deleteLinkSchema = z
  .object({
    linkId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    caregiverId: z.uuid().optional(),
  })
  .refine((value) => Boolean(value.linkId || value.patientId), {
    message: "linkId or patientId is required",
    path: ["linkId"],
  });

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "");

type CaregiverLinkDataRow = {
  id: string;
  caregiver_id: string;
  patient_id: string;
  notes: string | null;
  created_at: string;
};

const getVerifierClient = async () => {
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseAdminClient();
  }
  return createSupabaseServerClient();
};

const resolveCaregiverId = (
  auth: { role: string; userId: string },
  requestedCaregiverId: string | undefined,
) => {
  if (auth.role === "caregiver") return auth.userId;
  return requestedCaregiverId ?? auth.userId;
};

const caregiverSchemaNotReadyResponse = (rawErrorMessage?: string) => {
  const diagnostics = getCaregiverSchemaDiagnostics();
  return NextResponse.json(
    {
      error: CAREGIVER_SCHEMA_CACHE_MESSAGE,
      code: "CAREGIVER_SCHEMA_CACHE_NOT_READY",
      schemaReloadSql: "NOTIFY pgrst, 'reload schema';",
      projectRefHint: getSupabaseProjectRefFromEnv(),
      envHint:
        diagnostics.hasRefMismatch && diagnostics.supabaseRef
          ? `Supabase ref=${diagnostics.supabaseRef}, Postgres ref=${diagnostics.postgresRefs.join(",") || "-"}`
          : null,
      rawErrorMessage: rawErrorMessage ?? null,
    },
    { status: 503 },
  );
};

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const readClient = await getVerifierClient();
  const { searchParams } = new URL(request.url);
  const requestedCaregiverId = searchParams.get("caregiverId");
  const caregiverId = resolveCaregiverId(
    { role: auth.role, userId: auth.userId },
    requestedCaregiverId ?? undefined,
  );

  if (auth.role === "caregiver" && caregiverId !== auth.userId) {
    return forbidden("Cannot read links of other caregivers");
  }

  const { data: links, error: linksError } = await withCaregiverSchemaRecovery<CaregiverLinkDataRow[]>(
    () =>
    readClient
      .from("caregiver_patient_links")
      .select("id, caregiver_id, patient_id, notes, created_at")
      .eq("caregiver_id", caregiverId)
      .order("created_at", { ascending: false })
      .limit(300),
  );

  if (linksError) {
    if (isCaregiverSchemaCacheError(linksError)) {
      return caregiverSchemaNotReadyResponse(linksError.message);
    }
    return NextResponse.json({ error: linksError.message }, { status: 400 });
  }

  const patientIds = (links ?? [])
    .map((row) => row.patient_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const [profilesResult, onboardingResult] = await Promise.all([
    patientIds.length
      ? readClient
          .from("profiles")
          .select("id, full_name, phone, role")
          .in("id", patientIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            full_name: string | null;
            phone: string | null;
            role: string;
          }>,
          error: null,
        }),
    patientIds.length
      ? readClient
          .from("user_onboarding_profiles")
          .select("user_id, disability_type, disability_severity, need_tts, need_navigation_guidance")
          .in("user_id", patientIds)
      : Promise.resolve({
          data: [] as Array<{
            user_id: string;
            disability_type: string | null;
            disability_severity: string | null;
            need_tts: boolean | null;
            need_navigation_guidance: boolean | null;
          }>,
          error: null,
        }),
  ]);

  if (profilesResult.error) {
    if (isCaregiverSchemaCacheError(profilesResult.error)) {
      return caregiverSchemaNotReadyResponse(profilesResult.error.message);
    }
    return NextResponse.json({ error: profilesResult.error.message }, { status: 400 });
  }
  if (onboardingResult.error) {
    if (isCaregiverSchemaCacheError(onboardingResult.error)) {
      return caregiverSchemaNotReadyResponse(onboardingResult.error.message);
    }
    return NextResponse.json({ error: onboardingResult.error.message }, { status: 400 });
  }

  const profileMap = new Map((profilesResult.data ?? []).map((row) => [row.id, row]));
  const onboardingMap = new Map((onboardingResult.data ?? []).map((row) => [row.user_id, row]));

  return NextResponse.json({
    links: (links ?? []).map((row) => {
      const profile = profileMap.get(row.patient_id);
      const onboarding = onboardingMap.get(row.patient_id);
      return {
        id: row.id,
        caregiverId: row.caregiver_id,
        patientId: row.patient_id,
        notes: row.notes,
        createdAt: row.created_at,
        patient: profile
          ? {
              id: profile.id,
              fullName: profile.full_name,
              phone: profile.phone,
              role: profile.role,
            }
          : null,
        onboarding: onboarding
          ? {
              disabilityType: onboarding.disability_type,
              disabilitySeverity: onboarding.disability_severity,
              needTts: onboarding.need_tts,
              needNavigationGuidance: onboarding.need_navigation_guidance,
            }
          : null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = createLinkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { caregiverId: requestedCaregiverId, patientId, patientPhone, notes } = parsed.data;
  const caregiverId = resolveCaregiverId(
    { role: auth.role, userId: auth.userId },
    requestedCaregiverId,
  );

  if (auth.role === "caregiver" && caregiverId !== auth.userId) {
    return forbidden("Cannot create link for other caregivers");
  }

  const verifier = await getVerifierClient();
  let resolvedPatientId = patientId ?? null;

  if (!resolvedPatientId && patientPhone) {
    const normalizedPhone = normalizePhone(patientPhone);
    const lookup = await verifier
      .from("profiles")
      .select("id, role, phone")
      .eq("role", "patient")
      .limit(200);

    if (lookup.error) {
      return NextResponse.json({ error: lookup.error.message }, { status: 400 });
    }

    const match = (lookup.data ?? []).find((row) => normalizePhone(row.phone ?? "") === normalizedPhone);
    resolvedPatientId = match?.id ?? null;
  }

  if (!resolvedPatientId) {
    return badRequest("Patient not found");
  }

  const patientLookup = await verifier
    .from("profiles")
    .select("id, role")
    .eq("id", resolvedPatientId)
    .maybeSingle();

  if (patientLookup.error) {
    return NextResponse.json({ error: patientLookup.error.message }, { status: 400 });
  }
  if (!patientLookup.data || patientLookup.data.role !== "patient") {
    return badRequest("Selected account is not a patient");
  }

  const writeClient = await getVerifierClient();
  const { data, error } = await withCaregiverSchemaRecovery<CaregiverLinkDataRow>(() =>
    writeClient
      .from("caregiver_patient_links")
      .upsert(
        {
          caregiver_id: caregiverId,
          patient_id: resolvedPatientId,
          assigned_by: auth.userId,
          notes: notes || null,
        },
        { onConflict: "caregiver_id,patient_id" },
      )
      .select("id, caregiver_id, patient_id, notes, created_at")
      .single(),
  );

  if (error || !data) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error?.message);
    }
    return NextResponse.json({ error: error?.message ?? "Cannot create caregiver link" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    link: {
      id: data.id,
      caregiverId: data.caregiver_id,
      patientId: data.patient_id,
      notes: data.notes,
      createdAt: data.created_at,
    },
  });
}

export async function DELETE(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = deleteLinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const caregiverId = resolveCaregiverId(
    { role: auth.role, userId: auth.userId },
    parsed.data.caregiverId,
  );

  if (auth.role === "caregiver" && caregiverId !== auth.userId) {
    return forbidden("Cannot delete link for other caregivers");
  }

  const writeClient = await getVerifierClient();
  let query = writeClient.from("caregiver_patient_links").delete().eq("caregiver_id", caregiverId);

  if (parsed.data.linkId) {
    query = query.eq("id", parsed.data.linkId);
  } else if (parsed.data.patientId) {
    query = query.eq("patient_id", parsed.data.patientId);
  }

  const { error } = await withCaregiverSchemaRecovery(() => query);
  if (error) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error.message);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
