import { ArrowRight, BellRing, Camera, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/layout/brand-logo";

export default function Home() {
  return (
    <div className="min-h-screen bg-[linear-gradient(140deg,#e0f2fe_0%,#ecfeff_38%,#f8fafc_70%,#ffffff_100%)]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-12 md:px-8 md:py-20">
        <section className="reveal-up grid gap-8 rounded-3xl border bg-white/90 p-8 shadow-sm md:grid-cols-[1.1fr_0.9fr] md:p-12">
          <div className="space-y-5">
            <BrandLogo href="/" imageClassName="h-14" priority />
            <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
              ผู้ช่วยอัจฉริยะ
              <br />
              สำหรับการกินยาอย่างปลอดภัย
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-600">
              สแกนยาแบบมีเสียงนำทางไทย, ติดตามเวลาเช้า-กลางวัน-เย็น, แจ้งเตือน SMS
              และเชื่อมต่อคุณหมอแบบ role-based ในระบบเดียว
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800"
              >
                เริ่มใช้งาน
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-700 px-5 py-2.5 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-50"
              >
                เข้าสู่ระบบ
              </Link>
            </div>
          </div>
          <div className="grid gap-4 rounded-2xl bg-slate-950 p-6 text-slate-100">
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-300">สถานะล่าสุด</p>
              <p className="mt-2 text-xl font-semibold">กำลังสแกนยา: Paracetamol 500 mg</p>
              <p className="mt-1 text-sm text-slate-300">คำแนะนำเสียง: ขยับไปทางขวาเล็กน้อย</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-300">การแจ้งเตือนถัดไป</p>
              <p className="mt-2 text-xl font-semibold">19:00 (เย็น)</p>
              <p className="mt-1 text-sm text-slate-300">SMS + เสียง AI ในแอป</p>
            </div>
          </div>
        </section>

        <section className="reveal-up reveal-delay-1 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: "สแกนยาแบบนำทาง",
              desc: "กล้อง + barcode/QR + OCR fallback พร้อมเสียงบอกทิศทาง",
              icon: Camera,
            },
            {
              title: "แจ้งเตือนกินยา",
              desc: "รองรับ preset และ custom schedule พร้อมบันทึก adherence",
              icon: BellRing,
            },
            {
              title: "เชื่อมต่อคุณหมอ",
              desc: "ส่งข้อความและขอนัดหมายให้แพทย์ติดตามผลได้ต่อเนื่อง",
              icon: Stethoscope,
            },
            {
              title: "ความปลอดภัย RBAC",
              desc: "แยกสิทธิ์ patient/doctor/admin และ invite หมอโดยแอดมินเท่านั้น",
              icon: ShieldCheck,
            },
          ].map((item) => (
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
