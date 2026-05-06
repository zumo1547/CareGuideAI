import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/types/domain";

type LinkScope = "doctor" | "caregiver";

const hasScopedLink = async ({
  supabase,
  scope,
  actorId,
  patientId,
}: {
  supabase: SupabaseClient;
  scope: LinkScope;
  actorId: string;
  patientId: string;
}) => {
  if (scope === "doctor") {
    const { data } = await supabase
      .from("patient_doctor_links")
      .select("id")
      .eq("doctor_id", actorId)
      .eq("patient_id", patientId)
      .maybeSingle();
    return Boolean(data);
  }

  const { data } = await supabase
    .from("caregiver_patient_links")
    .select("id")
    .eq("caregiver_id", actorId)
    .eq("patient_id", patientId)
    .maybeSingle();
  return Boolean(data);
};

export const canAccessPatientScope = async ({
  supabase,
  role,
  actorId,
  patientId,
}: {
  supabase: SupabaseClient;
  role: Role;
  actorId: string;
  patientId: string;
}) => {
  if (role === "admin") return true;
  if (patientId === actorId) return true;
  if (role === "patient") return false;
  if (role === "doctor") {
    return hasScopedLink({ supabase, scope: "doctor", actorId, patientId });
  }
  if (role === "caregiver") {
    return hasScopedLink({ supabase, scope: "caregiver", actorId, patientId });
  }
  return false;
};

export const getLinkedPatientIdsForCaregiver = async ({
  supabase,
  caregiverId,
}: {
  supabase: SupabaseClient;
  caregiverId: string;
}) => {
  const { data } = await supabase
    .from("caregiver_patient_links")
    .select("patient_id")
    .eq("caregiver_id", caregiverId)
    .order("created_at", { ascending: false })
    .limit(500);

  return (data ?? [])
    .map((row) => row.patient_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

