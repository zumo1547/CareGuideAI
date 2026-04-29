import {
  ArrowRight,
  BellRing,
  Camera,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Volume2,
} from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/layout/brand-logo";
import { hasAuthenticatedUser } from "@/lib/auth/session";

const featureCards = [
  {
    title: "สแกนฉลากยาแบบใช้งานจริง",
    desc: "ยกกล้องมือถือไปที่ซองยาได้ทันที รองรับ OCR ไทย/อังกฤษ พร้อมเสียงแนะนำการวางกล้อง",
    icon: Camera,
  },
  {
    title: "เตือนกินยาด้วย SMS + เสียง",
    desc: "แจ้งเตือนตามเวลาเช้า กลางวัน เย็น และเวลาเฉพาะ พร้อมติดตามว่ากินยาครบหรือไม่",
    icon: BellRing,
  },
  {
    title: "เชื่อมต่อคุณหมอและติดตามผล",
    desc: "ส่งอาการ ข้อความ และนัดหมายกับแพทย์ได้ในระบบเดียว ให้หมอเห็นแผนยาและผลการกินยา",
    icon: Stethoscope,
  },
  {
    title: "ความปลอดภัยตามบทบาทผู้ใช้",
    desc: "แยกสิทธิ์ผู้พิการ แพทย์ และแอดมินอย่างชัดเจน เพื่อความปลอดภัยของข้อมูลสุขภาพ",
    icon: ShieldCheck,
  },
];

const supportPoints = [
  "รองรับผู้พิการทางสายตาด้วยเสียงอ่านชื่อปุ่มที่กด",
  "มีโหมดตัวอักษรใหญ่และคอนทราสต์สูง",
  "ออกแบบให้กดง่ายบนมือถือด้วยปุ่มขนาดชัดเจน",
];

export default async function Home() {
  const isAuthenticated = await hasAuthenticatedUser();

  const primaryHref = isAuthenticated ? "/app" : "/register";
  const primaryLabel = isAuthenticated ? "ไปที่แดชบอร์ด" : "เริ่มใช้งาน";
  const secondaryHref = isAuthenticated ? "/app/scan" : "/login";
  const secondaryLabel = isAuthenticated ? "สแกนยาทันที" : "เข้าสู่ระบบ";

  return (
    <div className="min-h-screen bg-[linear-gradient(140deg,#e0f2fe_0%,#ecfeff_38%,#f8fafc_70%,#ffffff_100%)]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 md:px-8 md:py-20">
        <section className="reveal-up grid gap-8 rounded-3xl border bg-white/90 p-8 shadow-sm md:grid-cols-[1.15fr_0.85fr] md:p-12">
          <div className="space-y-5">
            <BrandLogo href={isAuthenticated ? "/app" : "/"} imageClassName="h-14" priority />
            <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
              CareGuideAI
              <br />
              ผู้ช่วยกินยาสำหรับผู้พิการทางสายตา
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-600">
              แอปนี้ช่วยให้ผู้พิการใช้ยาได้ง่ายขึ้น ปลอดภัยขึ้น และสื่อสารกับคุณหมอได้ต่อเนื่อง
              ผ่านระบบสแกนฉลากยาอัตโนมัติ การแจ้งเตือนกินยา และการติดตามผลในระบบเดียว
            </p>

            <div className="grid gap-2">
              {supportPoints.map((point) => (
                <div key={point} className="flex items-start gap-2 text-sm text-slate-700">
                  <Volume2 className="mt-0.5 h-4 w-4 text-cyan-700" />
                  <span>{point}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href={primaryHref}
                className="inline-flex items-center gap-2 rounded-full bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={secondaryHref}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-700 px-5 py-2.5 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-50"
              >
                {secondaryLabel}
              </Link>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl bg-slate-950 p-6 text-slate-100">
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-300">Flow การใช้งานหลัก</p>
              <p className="mt-2 text-lg font-semibold">เปิดกล้องสแกนยา อัตโนมัติ วิเคราะห์ และยืนยัน</p>
              <p className="mt-1 text-sm text-slate-300">
                เมื่ออ่านข้อมูลได้ ระบบจะหยุดสแกนและพาไปยืนยันผลทันที
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-300">การเตือนกินยา</p>
              <p className="mt-2 text-lg font-semibold">SMS + เสียงในแอป + ติดตามการกินยา</p>
              <p className="mt-1 text-sm text-slate-300">
                เตือนตามเวลาและส่งข้อมูลให้แพทย์ดูผลการรักษา
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-slate-200">
                <Smartphone className="h-4 w-4" />
                <span className="text-sm">เหมาะกับการใช้งานบนมือถือเป็นหลัก</span>
              </div>
            </div>
          </div>
        </section>

        <section className="reveal-up reveal-delay-1 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {featureCards.map((item) => (
            <article key={item.title} className="rounded-2xl border bg-white p-5 shadow-sm">
              <item.icon className="h-5 w-5 text-cyan-700" />
              <h2 className="mt-3 text-lg font-semibold text-slate-900">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.desc}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
