"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Mail, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
type OAuthProvider = "google" | "facebook";
type ProviderAvailability = Record<OAuthProvider, boolean | null>;

const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = {
  google: null,
  facebook: null,
};

interface LoginFormProps {
  nextPath?: string;
  initialError?: string | null;
}

const getSupabaseBaseUrl = () =>
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/u, "");

const getSupabaseProjectRef = () => {
  const supabaseUrl = getSupabaseBaseUrl();
  const match = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/u);
  return match?.[1] ?? null;
};

const buildProviderDisabledError = (provider: OAuthProvider) => {
  const providerName = provider === "google" ? "Google" : "Facebook";
  const projectRef = getSupabaseProjectRef();
  const callback = getSupabaseBaseUrl()
    ? `${getSupabaseBaseUrl()}/auth/v1/callback`
    : "https://<project-ref>.supabase.co/auth/v1/callback";

  return `ยังไม่ได้เปิด ${providerName} ใน Supabase โปรเจกต์ที่เว็บเชื่อมต่ออยู่${
    projectRef ? ` (${projectRef})` : ""
  } กรุณาไปที่ Supabase > Authentication > Providers แล้วเปิด ${providerName} พร้อมใส่ Client ID/Secret และตั้ง Redirect URI เป็น ${callback}`;
};

const parseProviderAvailability = (payload: unknown): ProviderAvailability => {
  if (!payload || typeof payload !== "object") {
    return DEFAULT_PROVIDER_AVAILABILITY;
  }

  const external = (payload as { external?: Record<string, unknown> }).external;
  if (!external || typeof external !== "object") {
    return DEFAULT_PROVIDER_AVAILABILITY;
  }

  return {
    google: typeof external.google === "boolean" ? external.google : null,
    facebook: typeof external.facebook === "boolean" ? external.facebook : null,
  };
};

export const LoginForm = ({ nextPath = "/app", initialError = null }: LoginFormProps) => {
  const [error, setError] = useState<string | null>(initialError);
  const [isPending, setPending] = useState(false);
  const [isSendingReset, setSendingReset] = useState(false);
  const [resetEmailInput, setResetEmailInput] = useState("");
  const [loginEmailInput, setLoginEmailInput] = useState("");
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);
  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>(
    DEFAULT_PROVIDER_AVAILABILITY,
  );
  const [isCheckingProviders, setCheckingProviders] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  const emailField = register("email");

  const googleDisabled = Boolean(oauthPending);
  const facebookDisabled = Boolean(oauthPending);

  const providerStatusText = useMemo(() => {
    const toText = (value: boolean | null) => {
      if (value === true) return "พร้อมใช้งาน";
      if (value === false) return "ยังไม่เปิดใน Supabase";
      return "กำลังตรวจสอบ";
    };
    return {
      google: toText(providerAvailability.google),
      facebook: toText(providerAvailability.facebook),
    };
  }, [providerAvailability.facebook, providerAvailability.google]);

  const getSafeNextPath = () => {
    if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/app";
    return nextPath;
  };

  const buildCallbackUrl = (targetPath: string) => {
    const params = new URLSearchParams({ next: targetPath });
    return `${window.location.origin}/auth/callback?${params.toString()}`;
  };

  const buildResetPasswordUrl = () => `${window.location.origin}/reset-password`;

  const refreshProviderStatus = async () => {
    const supabaseUrl = getSupabaseBaseUrl();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (!supabaseUrl || !anonKey) return null;

    setCheckingProviders(true);
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      const availability = parseProviderAvailability(payload);
      setProviderAvailability(availability);
      return availability;
    } catch {
      return null;
    } finally {
      setCheckingProviders(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshProviderStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    setError(null);
    setResetInfo(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword(values);

    setPending(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace(getSafeNextPath());
    router.refresh();
  });

  const requestPasswordReset = async () => {
    setError(null);
    setResetInfo(null);

    const candidateEmail = resetEmailInput.trim() || loginEmailInput.trim();
    const parsed = z.email().safeParse(candidateEmail);
    if (!parsed.success) {
      setError("กรุณากรอกอีเมลที่ถูกต้องสำหรับส่งลิงก์ตั้งรหัสผ่านใหม่");
      return;
    }

    setSendingReset(true);
    const supabase = createSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: buildResetPasswordUrl(),
    });
    setSendingReset(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setResetInfo(
      `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${parsed.data} แล้ว กรุณาเช็คอีเมลและกดลิงก์เพื่อเปลี่ยนรหัสผ่าน`,
    );
  };

  const signInWithProvider = async (provider: OAuthProvider) => {
    setError(null);
    setResetInfo(null);

    if (providerAvailability[provider] === false) {
      // แจ้งเตือนแบบไม่บล็อก เพื่อให้ผู้ใช้ยังลอง login ได้ในกรณี setting เพิ่งอัปเดต
      setError(buildProviderDisabledError(provider));
    }

    setOauthPending(provider);
    const supabase = createSupabaseBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: buildCallbackUrl(getSafeNextPath()),
      },
    });
    setOauthPending(null);

    if (oauthError) {
      if (oauthError.message.toLowerCase().includes("provider is not enabled")) {
        setError(buildProviderDisabledError(provider));
        void refreshProviderStatus();
        return;
      }

      const callbackHint = getSupabaseBaseUrl()
        ? `${getSupabaseBaseUrl()}/auth/v1/callback`
        : "https://<project-ref>.supabase.co/auth/v1/callback";
      setError(`${oauthError.message} (ตรวจ redirect URI ให้มี ${callbackHint})`);
    }
  };

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
            กดปุ่มด้านล่างก่อน แล้วพูดว่า &quot;เข้าสู่ระบบ&quot; ระบบจะถามยืนยันก่อนกดปุ่มให้
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
              {...emailField}
              onChange={(event) => {
                emailField.onChange(event);
                setLoginEmailInput(event.target.value);
              }}
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

          <div className="rounded-lg border border-cyan-200/70 bg-cyan-50/50 p-3">
            <p className="text-xs font-semibold text-cyan-900">ลืมรหัสผ่าน</p>
            <p className="mt-1 text-xs text-cyan-900/80">
              กรอกอีเมลแล้วกดส่งลิงก์ ระบบจะส่งอีเมลตั้งรหัสผ่านใหม่ให้ทันที
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={resetEmailInput}
                onChange={(event) => setResetEmailInput(event.target.value)}
                placeholder={loginEmailInput.trim() || "อีเมลสำหรับรับลิงก์รีเซ็ตรหัสผ่าน"}
                aria-label="อีเมลสำหรับรีเซ็ตรหัสผ่าน"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void requestPasswordReset()}
                disabled={isSendingReset}
                className="sm:min-w-[180px]"
              >
                {isSendingReset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                <span>{isSendingReset ? "กำลังส่งลิงก์..." : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}</span>
              </Button>
            </div>
          </div>
        </form>

        {resetInfo ? (
          <Alert>
            <AlertTitle>ส่งอีเมลสำเร็จ</AlertTitle>
            <AlertDescription>{resetInfo}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-foreground">สถานะ Social Login ของโปรเจกต์นี้</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => void refreshProviderStatus()}
                disabled={isCheckingProviders}
              >
                {isCheckingProviders ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                <span>{isCheckingProviders ? "ตรวจสอบ..." : "เช็คใหม่"}</span>
              </Button>
            </div>
            <p className="mt-1">Google: {providerStatusText.google}</p>
            <p>Facebook: {providerStatusText.facebook}</p>
            <p className="mt-2 break-all">
              โปรเจกต์ที่เว็บเชื่อมอยู่:{" "}
              <span className="font-medium text-foreground">{getSupabaseProjectRef() ?? "ไม่พบ project ref"}</span>
            </p>
            <p className="break-all">
              Callback ที่ต้องใช้:{" "}
              <span className="font-medium text-foreground">
                {getSupabaseBaseUrl() ? `${getSupabaseBaseUrl()}/auth/v1/callback` : "https://<project-ref>.supabase.co/auth/v1/callback"}
              </span>
            </p>
          </div>

          <p className="text-center text-xs text-muted-foreground">หรือเข้าสู่ระบบด้วยบัญชีอื่น</p>
          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void signInWithProvider("google")}
              disabled={googleDisabled}
              aria-label="เข้าสู่ระบบด้วย Google"
            >
              {oauthPending === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              <span>เข้าสู่ระบบด้วย Google</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void signInWithProvider("facebook")}
              disabled={facebookDisabled}
              aria-label="เข้าสู่ระบบด้วย Facebook"
            >
              {oauthPending === "facebook" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserRound className="h-4 w-4" />
              )}
              <span>เข้าสู่ระบบด้วย Facebook</span>
            </Button>
          </div>
        </div>

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
