import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  doctorId: z.uuid(),
  scheduledAt: z.string().optional().nullable(),
  requestNote: z.string().max(2000).optional(),
  patientId: z.uuid().optional(),
  appointmentId: z.uuid().optional(),
  status: z.enum(["pending", "confirmed", "completed"]).optional(),
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const supabase = await createSupabaseServerClient();

  if (payload.appointmentId && payload.status) {
    if (auth.role === "patient") {
      return forbidden("Patient cannot update appointment status");
    }

    const updates: Record<string, unknown> = {
      status: payload.status,
      updated_at: new Date().toISOString(),
    };

    if (payload.scheduledAt) {
      updates.scheduled_at = new Date(payload.scheduledAt).toISOString();
    }

    const { error } = await supabase
      .from("appointments")
      .update(updates)
      .eq("id", payload.appointmentId)
      .eq("doctor_id", auth.role === "doctor" ? auth.userId : payload.doctorId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, updated: true });
  }

  const patientId = auth.role === "patient" ? auth.userId : payload.patientId;
  if (!patientId) {
    return badRequest("patientId is required");
  }

  const { data: link } = await supabase
    .from("patient_doctor_links")
    .select("id")
    .eq("patient_id", patientId)
    .eq("doctor_id", payload.doctorId)
    .maybeSingle();

  if (!link && auth.role !== "admin") {
    return forbidden("Patient and doctor are not linked");
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      doctor_id: payload.doctorId,
      requested_by: auth.userId,
      request_note: payload.requestNote ?? null,
      scheduled_at: payload.scheduledAt ? new Date(payload.scheduledAt).toISOString() : null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "สร้างคำขอนัดหมายไม่สำเร็จ" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    appointmentId: data.id,
  });
}
