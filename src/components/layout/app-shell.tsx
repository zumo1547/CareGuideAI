import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Role } from "@/types/domain";

const navByRole: Record<Role, { href: string; label: string }[]> = {
  patient: [
    { href: "/app/patient", label: "หน้าแดชบอร์ดผู้พิการ" },
    { href: "/app/scan", label: "สแกนยา" },
    { href: "/app/profile", label: "แฟ้มข้อมูลของฉัน" },
  ],
  doctor: [
    { href: "/app/doctor", label: "หน้าแดชบอร์ดคุณหมอ" },
    { href: "/app/profile", label: "แฟ้มข้อมูลของฉัน" },
  ],
  admin: [{ href: "/app/admin", label: "หน้าแอดมิน" }],
};

interface AppShellProps {
  role: Role;
  fullName: string;
  children: React.ReactNode;
}

export const AppShell = ({ role, fullName, children }: AppShellProps) => (
  <div className="min-h-screen bg-[radial-gradient(circle_at_top,#ecfeff_0%,#f0fdfa_35%,#f8fafc_65%,#ffffff_100%)]">
    <header className="border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <div className="space-y-2">
          <BrandLogo href="/app" imageClassName="h-11" />
          <h1 className="text-lg font-semibold">{fullName}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="capitalize">{role}</Badge>
          <LogoutButton />
        </div>
      </div>
      <Separator />
      <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 py-3 md:px-6">
        {navByRole[role].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            {item.label}
          </Link>
        ))}
        {role === "admin" ? (
          <>
            <Link
              href="/app/doctor"
              className="rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              ดูมุมมองหมอ
            </Link>
            <Link
              href="/app/patient"
              className="rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              ดูมุมมองผู้พิการ
            </Link>
          </>
        ) : null}
      </nav>
    </header>
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
      {children}
    </main>
  </div>
);
