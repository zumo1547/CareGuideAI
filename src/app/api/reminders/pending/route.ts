import { addMinutes, subHours } from "date-fns";
import { NextResponse } from "next/server";

import { getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await getApiAuthContext(["patient", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const supabase = await createSupabaseServerClient();
  const now = new Date();

  const { data: events } = await supabase
    .from("reminder_events")
    .select("id, due_at, plan_id")
    .eq("patient_id", auth.userId)
    .eq("channel", "voice")
    .eq("status", "pending")
    .gte("due_at", subHours(now, 2).toISOString())
    .lte("due_at", addMinutes(now, 2).toISOString())
    .order("due_at", { ascending: true })
    .limit(20);

  const planIds = (events ?? []).map((event) => event.plan_id).filter(Boolean);
  const { data: plans } = planIds.length
    ? await supabase
        .from("medication_plans")
        .select("id, dosage, medicine_id, is_active")
        .in("id", planIds)
    : { data: [] as { id: string; dosage: string; medicine_id: string; is_active: boolean }[] };

  const medicineIds = (plans ?? []).map((plan) => plan.medicine_id).filter(Boolean);
  const { data: medicines } = medicineIds.length
    ? await supabase.from("medicines").select("id, name").in("id", medicineIds)
    : { data: [] as { id: string; name: string }[] };

  const planMap = new Map((plans ?? []).map((plan) => [plan.id, plan]));
  const medicineMap = new Map((medicines ?? []).map((medicine) => [medicine.id, medicine.name]));

  const mapped = (events ?? [])
    .map((event) => {
      const plan = planMap.get(event.plan_id);
      if (plan && plan.is_active === false) {
        return null;
      }

      const medicineName = plan?.medicine_id
        ? medicineMap.get(plan.medicine_id) ?? "ยา"
        : "ยา";

      return {
        id: event.id,
        dueAt: event.due_at,
        planId: event.plan_id ?? null,
        message: `ถึงเวลากินยา ${medicineName} แล้ว`,
      };
    })
    .filter(
      (item): item is { id: string; dueAt: string; planId: string | null; message: string } =>
        Boolean(item),
    );

  return NextResponse.json({ events: mapped });
}
