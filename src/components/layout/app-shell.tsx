"use client";

import {
  Activity,
  FolderOpen,
  HandHelping,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  Stethoscope,
  Tablet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/domain";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  voiceAction?: string;
}

const navByRole: Record<Role, NavItem[]> = {
  patient: [
    {
      href: "/app/patient",
      label: "หน้าต่างหลัก",
      icon: LayoutDashboard,
      voiceAction: "go-patient-dashboard",
    },
    {
      href: "/app/scan/medicine",
      label: "สแกนยา",
      icon: Tablet,
      voiceAction: "go-medicine-scan-page",
    },
    {
      href: "/app/scan/blood-pressure",
      label: "สแกนความดัน",
      icon: Activity,
      voiceAction: "go-bp-scan-page",
    },
    {
      href: "/app/profile",
      label: "แฟ้มข้อมูลผู้ใช้งาน",
      icon: FolderOpen,
      voiceAction: "go-profile-page",
    },
  ],
  caregiver: [
    {
      href: "/app/caregiver",
      label: "หน้าต่างหลัก",
      icon: HandHelping,
    },
    {
      href: "/app/profile",
      label: "แฟ้มข้อมูลผู้ใช้งาน",
      icon: FolderOpen,
    },
  ],
  doctor: [
    {
      href: "/app/doctor",
      label: "หน้าต่างหลัก",
      icon: Stethoscope,
    },
    {
      href: "/app/profile",
      label: "แฟ้มข้อมูลผู้ใช้งาน",
      icon: FolderOpen,
    },
  ],
  admin: [
    {
      href: "/app/admin",
      label: "หน้าต่างหลัก",
      icon: ShieldCheck,
    },
  ],
};

const adminExtraLinks: NavItem[] = [
  { href: "/app/doctor", label: "มุมมองแพทย์", icon: Stethoscope },
  { href: "/app/patient", label: "มุมมองผู้พิการ", icon: LayoutDashboard },
];

const roleLabel: Record<Role, string> = {
  patient: "ผู้พิการ",
  caregiver: "ผู้ดูแล",
  doctor: "แพทย์",
  admin: "แอดมิน",
};

interface AppShellProps {
  role: Role;
  fullName: string;
  children: ReactNode;
}

export const AppShell = ({ role, fullName, children }: AppShellProps) => {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = useMemo(
    () => (role === "admin" ? [...navByRole[role], ...adminExtraLinks] : navByRole[role]),
    [role],
  );

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const renderNavItem = (item: NavItem, mobile = false) => {
    const active = isCurrent(item.href);
    const Icon = item.icon;

    return (
      <Link
        key={`${mobile ? "m" : "d"}-${item.href}`}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        data-voice-action={item.voiceAction}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition",
          active
            ? "border-cyan-700 bg-cyan-700 text-white shadow-sm"
            : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900",
          mobile ? "w-full justify-start" : "",
        )}
      >
        <Icon className={cn("h-4 w-4", active ? "text-white" : "text-cyan-700")} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#ecfeff_0%,#f0fdfa_35%,#f8fafc_65%,#ffffff_100%)]">
      <header className="sticky top-0 z-40 border-b border-cyan-100 bg-white/90 backdrop-blur-xl" role="banner">
        <div className="mx-auto w-full max-w-7xl px-4 py-3 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((prev) => !prev)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 md:hidden"
                aria-label={mobileOpen ? "ปิดเมนูหลัก" : "เปิดเมนูหลัก"}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <BrandLogo href="/app" imageClassName="h-10" />
              <div className="hidden min-w-0 md:block">
                <p className="text-xs text-slate-500">ผู้ใช้งานปัจจุบัน</p>
                <p className="truncate text-sm font-semibold text-slate-900">{fullName}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge className="bg-cyan-700 text-white hover:bg-cyan-700">{roleLabel[role]}</Badge>
              <div className="hidden sm:block">
                <LogoutButton />
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3 md:hidden">
            <p className="truncate text-sm font-semibold text-slate-900">{fullName}</p>
            <div className="mt-2 sm:hidden">
              <LogoutButton />
            </div>
          </div>

          <nav className="mt-3 hidden flex-wrap gap-2 md:flex" aria-label="เมนูหลักของระบบ">
            {navItems.map((item) => renderNavItem(item))}
          </nav>

          {mobileOpen ? (
            <nav className="mt-3 grid gap-2 md:hidden" aria-label="เมนูหลักบนมือถือ">
              {navItems.map((item) => renderNavItem(item, true))}
            </nav>
          ) : null}
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6"
        aria-label="เนื้อหาหลัก"
      >
        {children}
      </main>
    </div>
  );
};
