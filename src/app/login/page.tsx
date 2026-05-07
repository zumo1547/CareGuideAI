import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { BrandLogo } from "@/components/layout/brand-logo";
import { hasAuthenticatedUser } from "@/lib/auth/session";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const toSingle = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await hasAuthenticatedUser()) {
    redirect("/app");
  }

  const resolvedSearchParams = await searchParams;
  const nextPath = toSingle(resolvedSearchParams.next) ?? "/app";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_45%,#ffffff_100%)]">
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10 md:px-8">
        <div className="grid w-full gap-8 md:grid-cols-2">
          <section className="space-y-4 reveal-up">
            <BrandLogo href="/" imageClassName="h-14" />
            <h1 className="text-4xl font-bold leading-tight text-slate-900">
              เข้าสู่ระบบ
              <br />
              เพื่อเริ่มดูแลแผนยา
            </h1>
            <p className="text-slate-600">
              รองรับผู้พิการ คุณหมอ และแอดมิน พร้อมระบบสแกนยา นัดหมาย และติดตามการรักษาในที่เดียว
            </p>
            <p className="text-sm text-muted-foreground">
              ยังไม่มีบัญชี?{" "}
              <Link href="/register" data-voice-action="go-register-page">
                สมัครสมาชิก
              </Link>
            </p>
          </section>

          <section className="reveal-up reveal-delay-1">
            <LoginForm nextPath={nextPath} />
          </section>
        </div>
      </main>
    </div>
  );
}
