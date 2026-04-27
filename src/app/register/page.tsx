import Link from "next/link";

import { RegisterForm } from "@/components/auth/register-form";
import { BrandLogo } from "@/components/layout/brand-logo";

interface RegisterPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const toSingle = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const resolvedSearchParams = await searchParams;
  const inviteToken = toSingle(resolvedSearchParams.invite) ?? "";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_45%,#ffffff_100%)]">
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10 md:px-8">
        <div className="grid w-full gap-8 md:grid-cols-2">
          <section className="space-y-4">
            <BrandLogo href="/" imageClassName="h-14" priority />
            <h1 className="text-4xl font-bold leading-tight text-slate-900">
              สมัครใช้งาน
              <br />
              เพื่อจัดการยาอย่างมั่นใจ
            </h1>
            <p className="text-slate-600">
              ผู้พิการสมัครได้ทันที ส่วนบัญชีหมอใช้ระบบ invite โดยแอดมินในหน้า back office
            </p>
            <p className="text-sm text-muted-foreground">
              มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
            </p>
          </section>
          <section>
            <RegisterForm inviteTokenFromUrl={inviteToken} />
          </section>
        </div>
      </main>
    </div>
  );
}
