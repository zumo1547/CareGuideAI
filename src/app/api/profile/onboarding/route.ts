import { NextResponse } from "next/server";

import { calculateBmi, onboardingSchema } from "@/lib/onboarding";
import {
  buildPersistedOnboardingProfile,
  isSchemaCacheMissingError,
  ONBOARDING_PROFILE_METADATA_KEY,
  ONBOARDING_PROFILE_SELECT_COLUMNS,
  readOnboardingProfileFromMetadata,
} from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const toReadableDbError = (error: { message: string; code?: string | null }) => {
  if (isSchemaCacheMissingError(error)) {
    return "ตาราง onboarding ยังไม่พร้อมจาก Supabase schema cache ระบบจะพยายามบันทึกแบบสำรองให้อัตโนมัติ และคุณควรรัน SQL migration ในโปรเจกต์ที่เว็บใช้งานจริง";
  }
  return error.message;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .select(ONBOARDING_PROFILE_SELECT_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaCacheMissingError(error)) {
      const metadataProfile = readOnboardingProfileFromMetadata(user);
      return NextResponse.json({
        completed: Boolean(metadataProfile),
        profile: metadataProfile,
        storage: "metadata_fallback",
      });
    }
    return NextResponse.json({ error: toReadableDbError(error) }, { status: 500 });
  }

  return NextResponse.json({
    completed: Boolean(data),
    profile: data ?? null,
    storage: "table",
  });
}

export async function POST(request: Request) {
  const parsed = onboardingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid onboarding payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  const payload = parsed.data;
  const bmi = calculateBmi(payload.weightKg, payload.heightCm);

  const existingFallback = readOnboardingProfileFromMetadata(user);
  const persisted = buildPersistedOnboardingProfile(user.id, payload, bmi, existingFallback);

  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .upsert(persisted, { onConflict: "user_id" })
    .select(ONBOARDING_PROFILE_SELECT_COLUMNS)
    .single();

  if (error) {
    if (!isSchemaCacheMissingError(error)) {
      return NextResponse.json({ error: toReadableDbError(error) }, { status: 500 });
    }

    const { data: updated, error: updateError } = await supabase.auth.updateUser({
      data: {
        [ONBOARDING_PROFILE_METADATA_KEY]: persisted,
        onboarding_completed: true,
      },
    });

    if (updateError) {
      return NextResponse.json(
        { error: `บันทึกแบบสำรองไม่สำเร็จ: ${updateError.message}` },
        { status: 500 },
      );
    }

    const metadataProfile = readOnboardingProfileFromMetadata(updated.user ?? user) ?? persisted;
    return NextResponse.json({
      success: true,
      profile: metadataProfile,
      storage: "metadata_fallback",
    });
  }

  return NextResponse.json({
    success: true,
    profile: data,
    storage: "table",
  });
}
