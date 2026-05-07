"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { VoiceModeStartButton } from "@/components/accessibility/voice-mode-start-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const schema = z.object({
  email: z.email("กรอกอีเมลให้ถูกต้อง"),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
});

type FormValues = z.infer<typeof schema>;

interface LoginFormProps {
  nextPath?: string;
}

export const LoginForm = ({ nextPath = "/app" }: LoginFormProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setPending] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword(values);

    setPending(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  });

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle>เข้าสู่ระบบ CareGuideAI</CardTitle>
        <CardDescription>สำหรับผู้พิการ คุณหมอ และแอดมิน</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>เข้าสู่ระบบไม่สำเร็จ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-xl border border-cyan-200/80 bg-cyan-50/60 p-3">
          <p className="text-sm font-semibold">เริ่มโหมดเสียงสำหรับหน้าเข้าสู่ระบบ</p>
          <p className="mt-1 text-xs text-muted-foreground">
            กดปุ่มด้านล่างก่อน แล้วพูดว่า “เข้าสู่ระบบ” ระบบจะถามยืนยันก่อนกดปุ่มให้
          </p>
          <VoiceModeStartButton
            label="เริ่มต้นโหมดใช้งานด้วยเสียง"
            className="mt-2 h-10 w-full rounded-xl"
          />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              aria-label="อีเมล"
              data-voice-field="login-email"
              {...register("email")}
            />
            {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              type="password"
              placeholder="********"
              aria-label="รหัสผ่าน"
              data-voice-field="login-password"
              {...register("password")}
            />
            {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : null}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isPending}
            data-voice-action="submit-login"
            aria-label="เข้าสู่ระบบ"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{isPending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</span>
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          ยังไม่มีบัญชี?{" "}
          <Link href="/register" data-voice-action="go-register-page" className="underline">
            สมัครสมาชิก
          </Link>
        </p>
      </CardContent>
    </Card>
  );
};
