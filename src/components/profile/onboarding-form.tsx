"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateBmi,
  DISABILITY_SEVERITY,
  DISABILITY_SEVERITY_LABELS,
  DISABILITY_TYPES,
  DISABILITY_TYPE_LABELS,
  onboardingSchema,
  type OnboardingFormValues,
  type OnboardingProfile,
} from "@/lib/onboarding";

interface OnboardingFormProps {
  initialProfile: OnboardingProfile | null;
  mode: "onboarding" | "profile";
}

const toNumber = (value: unknown, fallback: number) => {
  const converted = Number(value);
  return Number.isFinite(converted) && converted > 0 ? converted : fallback;
};

const defaultsFromProfile = (profile: OnboardingProfile | null): OnboardingFormValues => ({
  disabilityType: profile?.disability_type ?? "normal",
  disabilityOther: profile?.disability_other ?? "",
  disabilitySeverity: profile?.disability_severity ?? "none",
  chronicConditions: profile?.chronic_conditions ?? "",
  regularMedications: profile?.regular_medications ?? "",
  drugAllergies: profile?.drug_allergies ?? "",
  baselineBloodPressure: profile?.baseline_blood_pressure ?? "",
  baselineBloodSugar: profile?.baseline_blood_sugar ?? "",
  weightKg: toNumber(profile?.weight_kg, 60),
  heightCm: toNumber(profile?.height_cm, 165),
  needTts: profile?.need_tts ?? true,
  needLargeText: profile?.need_large_text ?? true,
  needLargeButtons: profile?.need_large_buttons ?? true,
  needNavigationGuidance: profile?.need_navigation_guidance ?? true,
});

export const OnboardingForm = ({ initialProfile, mode }: OnboardingFormProps) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: defaultsFromProfile(initialProfile),
  });

  const weightKg = useWatch({ control, name: "weightKg" });
  const heightCm = useWatch({ control, name: "heightCm" });
  const disabilityType = useWatch({ control, name: "disabilityType" });

  const bmiPreview = useMemo(() => {
    const nextWeight = Number(weightKg);
    const nextHeight = Number(heightCm);
    if (!nextWeight || !nextHeight) return 0;
    return calculateBmi(nextWeight, nextHeight);
  }, [heightCm, weightKg]);

  useEffect(() => {
    if (disabilityType === "normal") {
      setValue("disabilitySeverity", "none", { shouldValidate: true });
      setValue("disabilityOther", "");
      return;
    }

    if (disabilityType !== "other") {
      setValue("disabilityOther", "");
    }
  }, [disabilityType, setValue]);

  const submit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/profile/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const payload = (await response.json()) as { error?: string };
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "บันทึกข้อมูลไม่สำเร็จ");
      return;
    }

    setSuccess(mode === "onboarding" ? "บันทึกข้อมูลเรียบร้อย กำลังพาไปหน้าใช้งานหลัก" : "บันทึกการแก้ไขเรียบร้อย");
    if (mode === "onboarding") {
      window.setTimeout(() => {
        router.replace("/app");
        router.refresh();
      }, 350);
      return;
    }

    router.refresh();
  });

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Stethoscope className="h-5 w-5 text-cyan-700" />
          {mode === "onboarding" ? "ข้อมูลพื้นฐานก่อนเริ่มใช้งาน" : "แฟ้มข้อมูลสุขภาพและการเข้าถึง"}
        </CardTitle>
        <CardDescription>
          {mode === "onboarding"
            ? "ทุกคนต้องกรอกครั้งแรกก่อนใช้งานระบบ เพื่อให้ CareGuideAI ปรับการช่วยเหลือได้เหมาะสม"
            : "แก้ไขข้อมูลได้ตลอดเวลา ข้อมูลนี้ใช้ช่วยเตือนยาและปรับประสบการณ์การใช้งาน"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>บันทึกไม่สำเร็จ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={submit} className="space-y-6">
          <section className="space-y-4 rounded-xl border p-4">
            <h3 className="font-semibold">ประเภทความพิการ</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>ประเภท</Label>
                <Controller
                  name="disabilityType"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value ?? "visual")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISABILITY_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {DISABILITY_TYPE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>ระดับความรุนแรง</Label>
                <Controller
                  name="disabilitySeverity"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value ?? (disabilityType === "normal" ? "none" : "moderate"))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(disabilityType === "normal"
                          ? (["none"] as const)
                          : DISABILITY_SEVERITY.filter((item) => item !== "none")
                        ).map((value) => (
                          <SelectItem key={value} value={value}>
                            {DISABILITY_SEVERITY_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.disabilitySeverity ? (
                  <p className="text-sm text-destructive">{errors.disabilitySeverity.message}</p>
                ) : null}
              </div>
            </div>

            {disabilityType === "other" ? (
              <div className="space-y-2">
                <Label htmlFor="disabilityOther">ระบุประเภทความพิการ</Label>
                <Input id="disabilityOther" {...register("disabilityOther")} />
                {errors.disabilityOther ? (
                  <p className="text-sm text-destructive">{errors.disabilityOther.message}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border p-4">
            <h3 className="font-semibold">ข้อมูลสุขภาพและประวัติการรักษา</h3>

            <div className="space-y-2">
              <Label htmlFor="chronicConditions">โรคประจำตัว</Label>
              <Textarea id="chronicConditions" rows={3} {...register("chronicConditions")} />
              {errors.chronicConditions ? (
                <p className="text-sm text-destructive">{errors.chronicConditions.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="regularMedications">ยาที่ใช้ประจำ</Label>
              <Textarea id="regularMedications" rows={3} {...register("regularMedications")} />
              {errors.regularMedications ? (
                <p className="text-sm text-destructive">{errors.regularMedications.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="drugAllergies">ประวัติการแพ้ยา</Label>
              <Textarea id="drugAllergies" rows={3} {...register("drugAllergies")} />
              {errors.drugAllergies ? (
                <p className="text-sm text-destructive">{errors.drugAllergies.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="baselineBloodPressure">ค่าพื้นฐานความดัน (ตัวอย่าง 120/80)</Label>
                <Input id="baselineBloodPressure" {...register("baselineBloodPressure")} />
                {errors.baselineBloodPressure ? (
                  <p className="text-sm text-destructive">{errors.baselineBloodPressure.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="baselineBloodSugar">ค่าน้ำตาลพื้นฐาน (mg/dL)</Label>
                <Input id="baselineBloodSugar" {...register("baselineBloodSugar")} />
                {errors.baselineBloodSugar ? (
                  <p className="text-sm text-destructive">{errors.baselineBloodSugar.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="weightKg">น้ำหนัก (กก.)</Label>
                <Input
                  id="weightKg"
                  type="number"
                  step="0.1"
                  {...register("weightKg", { valueAsNumber: true })}
                />
                {errors.weightKg ? <p className="text-sm text-destructive">{errors.weightKg.message}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="heightCm">ส่วนสูง (ซม.)</Label>
                <Input
                  id="heightCm"
                  type="number"
                  step="0.1"
                  {...register("heightCm", { valueAsNumber: true })}
                />
                {errors.heightCm ? <p className="text-sm text-destructive">{errors.heightCm.message}</p> : null}
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">BMI (คำนวณอัตโนมัติ)</p>
                <p className="text-2xl font-semibold">{bmiPreview ? bmiPreview.toFixed(2) : "-"}</p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border p-4">
            <h3 className="font-semibold">การเข้าถึงที่ต้องการ</h3>
            <div className="grid gap-3">
              <label className="flex items-center gap-3 text-sm">
                <Controller
                  name="needTts"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                ต้องการเสียงอ่าน (Text-to-Speech)
              </label>

              <label className="flex items-center gap-3 text-sm">
                <Controller
                  name="needLargeText"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                ต้องการตัวอักษรใหญ่
              </label>

              <label className="flex items-center gap-3 text-sm">
                <Controller
                  name="needLargeButtons"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                ต้องการปุ่มใหญ่ / ใช้ง่าย
              </label>

              <label className="flex items-center gap-3 text-sm">
                <Controller
                  name="needNavigationGuidance"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                ต้องการระบบนำทาง (บอกซ้าย-ขวา/ระยะกล้อง)
              </label>
            </div>
          </section>

          <Button type="submit" className="w-full md:w-auto" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>
              {loading
                ? "กำลังบันทึก..."
                : mode === "onboarding"
                  ? "บันทึกและเริ่มใช้งาน"
                  : "บันทึกการแก้ไข"}
            </span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
