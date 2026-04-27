import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid(),
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { patientId, doctorId } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: doctor, error: doctorError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", doctorId)
    .single();

  if (doctorError || !doctor || doctor.role !== "doctor") {
    return NextResponse.json({ error: "doctorId ไม่ใช่บัญชีหมอ" }, { status: 400 });
  }

  const { data: patient, error: patientError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", patientId)
    .single();

  if (patientError || !patient || patient.role !== "patient") {
    return NextResponse.json({ error: "patientId ไม่ใช่บัญชีผู้พิการ" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("patient_doctor_links")
    .upsert(
      {
        patient_id: patientId,
        doctor_id: doctorId,
        assigned_by: auth.userId,
      },
      { onConflict: "patient_id,doctor_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "จับคู่ไม่สำเร็จ" }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.userId,
    action: "assign_patient_doctor",
    targetType: "patient_doctor_link",
    targetId: data.id,
    payload: { patientId, doctorId },
  });

  return NextResponse.json({ success: true, linkId: data.id });
}
