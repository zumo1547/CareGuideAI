import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const assignSchema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid(),
});

const unassignSchema = z.union([
  z.object({ linkId: z.uuid() }),
  z.object({ patientId: z.uuid(), doctorId: z.uuid() }),
]);

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = assignSchema.safeParse(await request.json());
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
    return NextResponse.json({ error: "patientId ไม่ใช่บัญชีผู้ป่วย" }, { status: 400 });
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

export async function DELETE(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = unassignSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const supabase = await createSupabaseServerClient();

  let targetLink:
    | {
        id: string;
        patient_id: string;
        doctor_id: string;
      }
    | null = null;

  if ("linkId" in parsed.data) {
    const { data, error } = await supabase
      .from("patient_doctor_links")
      .select("id, patient_id, doctor_id")
      .eq("id", parsed.data.linkId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    targetLink = data;
  } else {
    const { data, error } = await supabase
      .from("patient_doctor_links")
      .select("id, patient_id, doctor_id")
      .eq("patient_id", parsed.data.patientId)
      .eq("doctor_id", parsed.data.doctorId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    targetLink = data;
  }

  if (!targetLink) {
    return NextResponse.json({ error: "ไม่พบคู่คนไข้-หมอที่ต้องการยกเลิก" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("patient_doctor_links")
    .delete()
    .eq("id", targetLink.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.userId,
    action: "unassign_patient_doctor",
    targetType: "patient_doctor_link",
    targetId: targetLink.id,
    payload: { patientId: targetLink.patient_id, doctorId: targetLink.doctor_id },
  });

  return NextResponse.json({
    success: true,
    linkId: targetLink.id,
  });
}
