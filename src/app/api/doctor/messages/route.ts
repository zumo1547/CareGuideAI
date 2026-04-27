import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  doctorId: z.uuid(),
  patientId: z.uuid().optional(),
  subject: z.string().max(120).optional(),
  message: z.string().min(1).max(4000),
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

  const { doctorId, subject, message } = parsed.data;
  const patientId =
    auth.role === "patient" ? auth.userId : parsed.data.patientId ?? (auth.role === "admin" ? undefined : null);

  if (!patientId) {
    return badRequest("patientId is required for doctor/admin message");
  }

  const supabase = await createSupabaseServerClient();

  const { data: link } = await supabase
    .from("patient_doctor_links")
    .select("id")
    .eq("doctor_id", doctorId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (!link && auth.role !== "admin") {
    return forbidden("Patient and doctor are not linked");
  }

  if (auth.role === "doctor" && auth.userId !== doctorId) {
    return forbidden("Doctor can only send from their own account");
  }

  const { data, error } = await supabase
    .from("doctor_messages")
    .insert({
      doctor_id: doctorId,
      patient_id: patientId,
      sender_id: auth.userId,
      subject: subject ?? null,
      message,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "ส่งข้อความไม่สำเร็จ" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    messageId: data.id,
  });
}
