"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MedicineSearchResult } from "@/types/domain";

const schema = z.object({
  medicineQuery: z.string().min(2, "กรุณากรอกชื่อยาหรือรหัสยา"),
  dosage: z.string().min(1, "กรุณากรอกขนาดยา"),
  notes: z.string().optional(),
  customTimes: z.string().optional(),
  morning: z.boolean(),
  noon: z.boolean(),
  evening: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface MedicationPlanFormProps {
  patientId: string;
}

export const MedicationPlanForm = ({ patientId }: MedicationPlanFormProps) => {
  const router = useRouter();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MedicineSearchResult[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      morning: true,
      noon: false,
      evening: true,
    },
  });

  const medicineQuery = useWatch({ control, name: "medicineQuery" });
  const selectedMedicine = useMemo(
    () => suggestions.find((item) => item.sourceId === selectedSourceId) ?? null,
    [selectedSourceId, suggestions],
  );

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      if (!medicineQuery || medicineQuery.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      const response = await fetch(
        `/api/medicines/search?q=${encodeURIComponent(medicineQuery.trim())}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: MedicineSearchResult[] };
      setSuggestions(payload.data ?? []);
      setSelectedSourceId(payload.data?.[0]?.sourceId ?? null);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [medicineQuery]);

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const customTimes = values.customTimes
      ?.split(",")
      .map((part: string) => part.trim())
      .filter(Boolean) ?? [];

    const presets = [
      values.morning ? "morning" : null,
      values.noon ? "noon" : null,
      values.evening ? "evening" : null,
    ].filter(Boolean);

    const response = await fetch("/api/medication-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        medicineQuery: values.medicineQuery,
        selectedSourceId,
        dosage: values.dosage,
        notes: values.notes,
        schedule: {
          presets,
          customTimes,
        },
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "สร้างแผนกินยาไม่สำเร็จ");
      return;
    }

    setSuccess("บันทึกแผนกินยาเรียบร้อยแล้ว");
    reset({
      medicineQuery: "",
      dosage: "",
      notes: "",
      customTimes: "",
      morning: true,
      noon: false,
      evening: true,
    });
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          เพิ่มยาและตารางกินยา
        </CardTitle>
        <CardDescription>
          รองรับทั้ง preset เช้า-กลางวัน-เย็น และเวลา custom รายยา
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="medicineQuery">ชื่อยา / รหัสยา</Label>
            <Input
              id="medicineQuery"
              {...register("medicineQuery")}
              list="medicine-options"
              placeholder="เช่น Paracetamol"
              onBlur={(event) => setValue("medicineQuery", event.target.value)}
            />
            <datalist id="medicine-options">
              {suggestions.map((item) => (
                <option
                  key={item.sourceId}
                  value={item.name}
                  onClick={() => setSelectedSourceId(item.sourceId)}
                >
                  {item.name}
                </option>
              ))}
            </datalist>
            {selectedMedicine ? (
              <p className="text-xs text-muted-foreground">
                แนะนำ: {selectedMedicine.name} ({selectedMedicine.source})
              </p>
            ) : null}
            {errors.medicineQuery ? (
              <p className="text-sm text-destructive">{errors.medicineQuery.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dosage">ขนาดยา/วิธีใช้</Label>
            <Input id="dosage" placeholder="เช่น 1 เม็ด หลังอาหาร" {...register("dosage")} />
            {errors.dosage ? <p className="text-sm text-destructive">{errors.dosage.message}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>Preset เวลา</Label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Controller
                  control={control}
                  name="morning"
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                เช้า (08:00)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Controller
                  control={control}
                  name="noon"
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                กลางวัน (13:00)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Controller
                  control={control}
                  name="evening"
                  render={({ field }) => (
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  )}
                />
                เย็น (19:00)
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customTimes">เวลา custom (คั่นด้วย comma)</Label>
            <Input id="customTimes" placeholder="เช่น 10:30, 22:00" {...register("customTimes")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">หมายเหตุ</Label>
            <Input id="notes" placeholder="เช่น ถ้าลืมกินให้แจ้งหมอ" {...register("notes")} />
          </div>

          <Button type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{isLoading ? "กำลังบันทึก..." : "บันทึกแผนยา"}</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
