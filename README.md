# CareGuideAI

CareGuideAI คือเว็บแอปช่วยผู้พิการจัดการยาแบบครบวงจร:
- สแกนยาแบบ Hybrid (Barcode/QR + OCR fallback)
- เสียงนำทางไทยระหว่างสแกนยา
- ตารางกินยาแบบ preset + custom ต่อรายการยา
- แจ้งเตือนผ่าน Mock SMS + Voice (Web TTS)
- ติดต่อคุณหมอผ่านข้อความและนัดหมาย
- RBAC 3 บทบาท: `patient`, `doctor`, `admin`
- หมอเป็นระบบ `admin invite only`

## Tech Stack

- Next.js (App Router) + React + TypeScript
- Supabase (Postgres + Auth + RLS)
- Tailwind CSS + shadcn/ui
- OpenFDA search integration (ยา)
- Vercel Cron (`/api/reminders/dispatch`)
- Vitest + Playwright

## Project Structure

- `src/app` : หน้าเว็บและ API routes
- `src/components` : UI components
- `src/lib` : business logic (auth/rbac/reminders/scan/openfda)
- `supabase/migrations` : SQL schema + RLS
- `e2e` : Playwright tests

## Environment

คัดลอกไฟล์ตัวอย่างก่อน:

```bash
cp .env.example .env.local
```

ตั้งค่าตัวแปรอย่างน้อย:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (เช่น `http://localhost:3000`)

## Supabase Setup

1. สร้าง Supabase project
2. เปิด SQL Editor แล้วรันไฟล์:
- `supabase/migrations/0001_careguideai.sql`
3. ตั้ง user แรกเป็น admin ด้วย SQL:

```sql
update public.profiles
set role = 'admin'
where id = '<YOUR_USER_UUID>';
```

## Run Locally

```bash
npm install
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run lint` - lint
- `npm run typecheck` - TypeScript check
- `npm run test` - unit/integration tests (Vitest)
- `npm run test:e2e` - e2e tests (Playwright)

## API Contracts (Implemented)

- `POST /api/scan/barcode`
- `POST /api/scan/ocr`
- `GET /api/medicines/search?q=...`
- `POST /api/medication-plans`
- `POST|GET /api/reminders/dispatch`
- `POST /api/doctor/messages`
- `POST /api/appointments`

เพิ่มเติม:
- `POST /api/auth/register`
- `POST /api/admin/invite-doctor`
- `POST /api/admin/assign-role`
- `POST /api/admin/assign-patient-doctor`
- `GET /api/reminders/pending`
- `POST /api/reminders/ack`
- `POST /api/adherence/log`

## Vercel Deployment

โปรเจกต์มี `vercel.json` ตั้ง cron ไว้แล้ว:
- ทุก 5 นาที เรียก `/api/reminders/dispatch`

ขั้นตอน:
1. เชื่อม GitHub repo กับ Vercel
2. ตั้ง Environment Variables ให้ครบ (เหมือน `.env.local`)
3. Deploy branch `main`

## GitHub Commands

ถ้ายังไม่ตั้ง remote:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/zumo1547/CareGuideAI.git
git push -u origin main
```

## Notes

- SMS ใน MVP ใช้ `MockSmsProvider` และเตรียม interface สำหรับต่อ Twilio ในรอบถัดไป
- Voice notification ฝั่งผู้ใช้ทำผ่าน Web Speech API (ภาษาไทย)

## Runtime SMS Provider

- If `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_PHONE` are present, `/api/reminders/dispatch` sends real SMS via Twilio.
- If one of these variables is missing, it automatically falls back to `MockSmsProvider`.
- Use E.164 phone format for patient phone numbers, for example `+66812345678`.
