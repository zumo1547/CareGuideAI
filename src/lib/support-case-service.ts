import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/types/domain";
import type {
  SupportCaseMessage,
  SupportCasePatientInfo,
  SupportCaseStatus,
  SupportCaseSummary,
} from "@/types/support-case";

type SupportCaseRow = {
  id: string;
  patient_id: string;
  requested_doctor_id: string;
  assigned_doctor_id: string | null;
  request_message: string;
  status: string;
  requested_at: string;
  accepted_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  updated_at: string;
};

type SupportCaseMessageRow = {
  id: string;
  case_id: string;
  sender_id: string;
  message: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
};

type OnboardingRow = {
  user_id: string;
  disability_type: string | null;
  disability_severity: string | null;
  chronic_conditions: string | null;
  drug_allergies: string | null;
  bmi: number | null;
  biological_sex: string | null;
};

const SUPPORT_CASE_COLUMNS =
  "id, patient_id, requested_doctor_id, assigned_doctor_id, request_message, status, requested_at, accepted_at, closed_at, closed_by, updated_at";

const unique = <T>(values: T[]) => [...new Set(values)];

export const isSupportCaseStatus = (status: string): status is SupportCaseStatus =>
  status === "pending" || status === "active" || status === "closed";

const normalizeSupportCaseStatus = (status: string): SupportCaseStatus =>
  isSupportCaseStatus(status) ? status : "pending";

const mapPatientInfo = (
  profile: ProfileRow | undefined,
  onboarding: OnboardingRow | undefined,
): SupportCasePatientInfo | null => {
  if (!profile) return null;

  return {
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone,
    disabilityType: onboarding?.disability_type ?? null,
    disabilitySeverity: onboarding?.disability_severity ?? null,
    chronicConditions: onboarding?.chronic_conditions ?? null,
    drugAllergies: onboarding?.drug_allergies ?? null,
    bmi: onboarding?.bmi ?? null,
    biologicalSex: onboarding?.biological_sex ?? null,
  };
};

export const fetchSupportCaseList = async ({
  supabase,
  userId,
  role,
  limit = 60,
}: {
  supabase: SupabaseClient;
  userId: string;
  role: Role;
  limit?: number;
}) => {
  let query = supabase
    .from("support_cases")
    .select(SUPPORT_CASE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (role === "patient") {
    query = query.eq("patient_id", userId);
  }

  if (role === "doctor") {
    query = query.or(`requested_doctor_id.eq.${userId},assigned_doctor_id.eq.${userId}`);
  }

  const { data: caseRows, error: caseError } = await query;
  if (caseError) {
    throw new Error(caseError.message);
  }

  const rows = (caseRows ?? []) as SupportCaseRow[];
  if (rows.length === 0) {
    return [] as SupportCaseSummary[];
  }

  const patientIds = unique(rows.map((row) => row.patient_id));
  const profileIds = unique(
    rows
      .flatMap((row) => [row.patient_id, row.requested_doctor_id, row.assigned_doctor_id])
      .filter((id): id is string => Boolean(id)),
  );

  const [{ data: profiles, error: profileError }, { data: onboarding, error: onboardingError }] =
    await Promise.all([
      profileIds.length
        ? supabase
            .from("profiles")
            .select("id, full_name, phone, role")
            .in("id", profileIds)
        : Promise.resolve({ data: [] as ProfileRow[], error: null }),
      patientIds.length
        ? supabase
            .from("user_onboarding_profiles")
            .select(
              "user_id, disability_type, disability_severity, chronic_conditions, drug_allergies, bmi, biological_sex",
            )
            .in("user_id", patientIds)
        : Promise.resolve({ data: [] as OnboardingRow[], error: null }),
    ]);

  if (profileError) {
    throw new Error(profileError.message);
  }
  if (onboardingError) {
    throw new Error(onboardingError.message);
  }

  const profileMap = new Map((profiles ?? []).map((item) => [item.id, item]));
  const onboardingMap = new Map((onboarding ?? []).map((item) => [item.user_id, item]));

  return rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    requestedDoctorId: row.requested_doctor_id,
    assignedDoctorId: row.assigned_doctor_id,
    requestMessage: row.request_message,
    status: normalizeSupportCaseStatus(row.status),
    requestedAt: row.requested_at,
    acceptedAt: row.accepted_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    updatedAt: row.updated_at,
    patient: mapPatientInfo(profileMap.get(row.patient_id), onboardingMap.get(row.patient_id)),
    requestedDoctor: (() => {
      const doctorProfile = profileMap.get(row.requested_doctor_id);
      if (!doctorProfile) return null;
      return {
        id: doctorProfile.id,
        fullName: doctorProfile.full_name,
        phone: doctorProfile.phone,
      };
    })(),
    assignedDoctor: (() => {
      if (!row.assigned_doctor_id) return null;
      const doctorProfile = profileMap.get(row.assigned_doctor_id);
      if (!doctorProfile) return null;
      return {
        id: doctorProfile.id,
        fullName: doctorProfile.full_name,
        phone: doctorProfile.phone,
      };
    })(),
  }));
};

export const fetchSupportCaseById = async ({
  supabase,
  caseId,
}: {
  supabase: SupabaseClient;
  caseId: string;
}) => {
  const { data, error } = await supabase
    .from("support_cases")
    .select(SUPPORT_CASE_COLUMNS)
    .eq("id", caseId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SupportCaseRow | null) ?? null;
};

export const fetchSupportCaseMessages = async ({
  supabase,
  caseId,
}: {
  supabase: SupabaseClient;
  caseId: string;
}) => {
  const { data: messageRows, error: messageError } = await supabase
    .from("support_case_messages")
    .select("id, case_id, sender_id, message, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (messageError) {
    throw new Error(messageError.message);
  }

  const rows = (messageRows ?? []) as SupportCaseMessageRow[];
  if (rows.length === 0) {
    return [] as SupportCaseMessage[];
  }

  const senderIds = unique(rows.map((row) => row.sender_id));
  const { data: senderProfiles, error: senderError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", senderIds);

  if (senderError) {
    throw new Error(senderError.message);
  }

  const senderMap = new Map((senderProfiles ?? []).map((item) => [item.id, item]));
  return rows.map((row) => {
    const sender = senderMap.get(row.sender_id);
    return {
      id: row.id,
      caseId: row.case_id,
      senderId: row.sender_id,
      senderName: sender?.full_name ?? row.sender_id,
      senderRole: sender?.role ?? null,
      message: row.message,
      createdAt: row.created_at,
    };
  });
};
