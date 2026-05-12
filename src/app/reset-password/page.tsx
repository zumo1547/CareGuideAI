"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { BrandLogo } from "@/components/layout/brand-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const schema = z
  .object({
    password: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string().min(8, "ยืนยันรหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "รหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    const checkSession = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      setHasRecoverySession(Boolean(data.session));
      setCheckingSession(false);
    };

    void checkSession();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password: values.password,
    });

    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("ตั้งรหัสผ่านใหม่สำเร็จ กำลังพาไปหน้าเข้าสู่ระบบ");
    window.setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1200);
  });

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_45%,#ffffff_100%)]">
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10 md:px-8">
        <div className="grid w-full gap-8 md:grid-cols-2">
          <section className="space-y-4 reveal-up">
            <BrandLogo href="/" imageClassName="h-14" />
            <h1 className="text-4xl font-bold leading-tight text-slate-900">
              ตั้งรหัสผ่านใหม่
              <br />
              เพื่อกลับเข้าใช้งาน
            </h1>
            <p className="text-slate-600">
              กรุณาตั้งรหัสผ่านใหม่อย่างปลอดภัย หลังจากกดลิงก์รีเซ็ตรหัสผ่านจากอีเมล
            </p>
            <p className="text-sm text-muted-foreground">
              กลับไปหน้า{" "}
              <Link href="/login" className="underline">
                เข้าสู่ระบบ
              </Link>
            </p>
          </section>

          <section className="reveal-up reveal-delay-1">
            <Card className="w-full shadow-lg">
              <CardHeader>
                <CardTitle>ตั้งรหัสผ่านใหม่</CardTitle>
                <CardDescription>รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>ตั้งรหัสผ่านไม่สำเร็จ</AlertTitle>
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

                {checkingSession ? (
                  <div className="rounded-lg border border-cyan-200/80 bg-cyan-50/60 p-3 text-sm text-cyan-900">
                    กำลังตรวจสอบลิงก์รีเซ็ตรหัสผ่าน...
                  </div>
                ) : null}

                {!checkingSession && !hasRecoverySession ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>ลิงก์รีเซ็ตใช้งานไม่ได้</AlertTitle>
                    <AlertDescription>
                      กรุณากดลิงก์จากอีเมลรีเซ็ตอีกครั้ง หรือกลับไปหน้าเข้าสู่ระบบเพื่อส่งลิงก์ใหม่
                    </AlertDescription>
                  </Alert>
                ) : null}

                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">รหัสผ่านใหม่</Label>
                    <Input id="password" type="password" placeholder="********" {...register("password")} />
                    {errors.password ? (
                      <p className="text-sm text-destructive">{errors.password.message}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="********"
                      {...register("confirmPassword")}
                    />
                    {errors.confirmPassword ? (
                      <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                    ) : null}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || checkingSession || !hasRecoverySession}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                    <span>{loading ? "กำลังบันทึกรหัสผ่าน..." : "บันทึกรหัสผ่านใหม่"}</span>
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
