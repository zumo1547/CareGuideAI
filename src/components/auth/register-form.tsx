"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const schema = z.object({
  fullName: z.string().min(2, "กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร"),
  email: z.email("อีเมลไม่ถูกต้อง"),
  phone: z.string().min(9, "กรุณากรอกเบอร์โทรศัพท์ให้ครบ"),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
  role: z.enum(["patient", "caregiver"]),
  inviteToken: z.string().optional(),
});

type RegisterFormValues = z.infer<typeof schema>;

interface RegisterFormProps {
  inviteTokenFromUrl?: string;
}

export const RegisterForm = ({ inviteTokenFromUrl = "" }: RegisterFormProps) => {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: "patient",
      inviteToken: inviteTokenFromUrl,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setLoading(false);
      setError(payload.error ?? "สมัครสมาชิกไม่สำเร็จ");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    setLoading(false);
    if (signInError) {
      setSuccess("สมัครสำเร็จแล้ว กรุณาเข้าสู่ระบบ");
      return;
    }

    router.replace("/app");
    router.refresh();
  });

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle>สมัครใช้งาน CareGuideAI</CardTitle>
        <CardDescription>
          เลือกได้เฉพาะผู้พิการหรือผู้ช่วยดูแล ส่วนคุณหมอสมัครได้ผ่าน Invite เท่านั้น
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>สมัครไม่สำเร็จ</AlertTitle>
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

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">ชื่อ-นามสกุล</Label>
            <Input id="fullName" {...register("fullName")} />
            {errors.fullName ? (
              <p className="text-sm text-destructive">{errors.fullName.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">อีเมล</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email ? (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">เบอร์โทรศัพท์</Label>
            <Input id="phone" {...register("phone")} />
            {errors.phone ? (
              <p className="text-sm text-destructive">{errors.phone.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input id="password" type="password" {...register("password")} />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">ประเภทผู้ใช้งาน</Label>
            <select
              id="role"
              {...register("role")}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            >
              <option value="patient">ผู้พิการ / ผู้ป่วย</option>
              <option value="caregiver">ผู้ช่วยดูแล (Caregiver)</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inviteToken">Invite Token (เฉพาะคุณหมอ)</Label>
            <Input id="inviteToken" {...register("inviteToken")} />
            <p className="text-xs text-muted-foreground">
              ถ้ามี token ระบบจะสมัครเป็นคุณหมออัตโนมัติและข้ามตัวเลือกบทบาทด้านบน
            </p>
          </div>

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{loading ? "กำลังสมัคร..." : "สมัครสมาชิก"}</span>
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
        </p>
      </CardContent>
    </Card>
  );
};
