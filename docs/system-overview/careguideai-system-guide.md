# CareGuideAI System Guide (Report-Ready Version)

## 1) บทนำ

CareGuideAI คือเว็บแอปพลิเคชันสำหรับช่วยผู้พิการทางสายตา ผู้สูงอายุ และผู้ป่วยที่ต้องใช้ยาอย่างต่อเนื่อง ให้สามารถ “ระบุตัวยาได้ถูกต้อง”, “เข้าใจวิธีใช้ยา”, “ได้รับการแจ้งเตือนตรงเวลา”, และ “สื่อสารกับแพทย์ได้ในระบบเดียว”

แนวคิดหลักของระบบคือ:
1. อ่านข้อมูลยาให้ถูก
2. แปลข้อมูลยาให้อยู่ในรูปแบบที่ระบบใช้งานต่อได้
3. สร้างแผนการใช้ยาและเตือนตามเวลาอัตโนมัติ
4. เปิดให้แพทย์และผู้ดูแลติดตามข้อมูลได้อย่างปลอดภัย

CareGuideAI จึงไม่ใช่เพียงเว็บสแกนฉลากยา แต่เป็นระบบดูแลการใช้ยาแบบครบวงจรที่เชื่อมระหว่างผู้ป่วย แพทย์ และผู้ดูแลระบบ

---

## 2) ที่มาของปัญหา

ปัญหาหลักที่ระบบนี้พยายามแก้มีดังนี้:
1. ผู้ใช้จำนวนมาก โดยเฉพาะผู้พิการทางสายตา อ่านฉลากยาได้ยาก
2. คำสั่งบนฉลากยามักอยู่ในรูปแบบข้อความ ไม่ใช่ข้อมูลโครงสร้าง
3. ผู้ใช้ที่มียาหลายรายการมีโอกาสจำเวลาและวิธีใช้ยาผิด
4. ข้อมูลการกินยาและการติดตามอาการมักกระจัดกระจาย
5. ระบบทางการแพทย์จำเป็นต้องแยกสิทธิ์ผู้ใช้และป้องกันข้อมูลสุขภาพอย่างเข้มงวด

ดังนั้นระบบที่ดีต้องตอบโจทย์ทั้ง “การเข้าถึง”, “ความปลอดภัย”, “ความแม่นยำ”, และ “การติดตามผล”

---

## 3) วัตถุประสงค์ของระบบ

1. ช่วยให้ผู้ใช้ระบุตัวยาได้จากกล้องและข้อความบนฉลากยา
2. ลดความเสี่ยงจากการอ่านผิดหรือกินยาผิด
3. แปลงข้อมูลจากฉลากยาเป็นแผนการใช้ยาอัตโนมัติ
4. แจ้งเตือนการกินยาตามเวลา ผ่าน SMS และเสียง
5. เปิดให้แพทย์ติดตามผู้ป่วย นัดหมาย และดูข้อมูลการใช้ยาได้
6. เปิดให้ผู้ดูแลระบบจัดการบทบาทผู้ใช้และความสัมพันธ์ระหว่างแพทย์กับผู้ป่วยได้

---

## 4) ขอบเขตของระบบ

ขอบเขตที่ระบบรองรับในเวอร์ชันปัจจุบันประกอบด้วย:
1. สมัครสมาชิกและล็อกอิน
2. ระบบ onboarding ด้านสุขภาพและความต้องการด้าน accessibility
3. สแกนยาแบบ Hybrid: Barcode/QR + OCR fallback
4. สแกนค่าความดันโลหิตด้วย OCR
5. สร้างแผนยาและตารางเวลา
6. สร้าง reminder events และ dispatch แจ้งเตือน
7. บันทึกการกินยาและติดตาม adherence
8. ส่งข้อความถึงแพทย์
9. สร้างและจัดการนัดหมาย
10. เปิด support case แบบแชต
11. ระบบ admin สำหรับ assign role, invite doctor, assign patient-doctor

สิ่งที่ยังไม่ใช่ขอบเขตหลักของเวอร์ชันนี้:
1. การวิเคราะห์ drug-drug interaction เชิงลึก
2. การตัดสินใจทางคลินิกแทนแพทย์
3. การเป็น medical device ที่ผ่านการรับรองเชิงกฎหมาย

---

## 5) กลุ่มผู้ใช้และบทบาท

ระบบรองรับผู้ใช้ 3 กลุ่มหลัก:

### 5.1 Patient
ผู้ใช้งานหลักของระบบ มีความสามารถดังนี้:
1. ลงทะเบียนและทำ onboarding
2. สแกนยาและตรวจสอบข้อมูลจาก OCR
3. สร้างแผนการกินยา
4. ดู reminder events
5. ส่งข้อความถึงแพทย์
6. เปิด support case
7. ขอ/ตอบรับ/ปฏิเสธ/ขอเลื่อนนัด
8. สแกนค่าความดันและดูประวัติ

### 5.2 Doctor
แพทย์ใช้ระบบเพื่อดูแลผู้ป่วยที่ถูก assign ให้ตนเอง:
1. ดูผู้ป่วยในความดูแล
2. ดู adherence trend
3. ตอบข้อความและเคสช่วยเหลือ
4. เสนอเวลานัดและปิดงานนัดหมาย
5. เข้าถึงข้อมูลผู้ป่วยที่เกี่ยวข้องตามสิทธิ์

### 5.3 Admin
ผู้ดูแลระบบมีหน้าที่กำกับทั้งระบบ:
1. กำหนด role ของผู้ใช้
2. เชิญแพทย์เข้าระบบ
3. เชื่อมผู้ป่วยกับแพทย์
4. ติดตาม invite, reminder failures, audit logs
5. ดูภาพรวมการใช้งานทั้งระบบ

---

## 6) ทำไมระบบนี้ต้องใช้ OCR

### 6.1 ข้อจำกัดของการใช้บาร์โค้ดอย่างเดียว

การใช้บาร์โค้ดช่วยระบุสินค้าได้เร็ว แต่ไม่เพียงพอสำหรับบริบทฉลากยา เพราะ:
1. ฉลากยาโรงพยาบาลจำนวนมากไม่มีบาร์โค้ดที่อ่านได้เสมอ
2. บาร์โค้ดไม่เก็บ “คำสั่งเฉพาะผู้ป่วย” เช่น วันละกี่ครั้ง ก่อนหรือหลังอาหาร
3. ข้อมูลสำคัญจริงของการใช้ยาอยู่ในตัวหนังสือบนฉลาก

### 6.2 ข้อจำกัดของการกรอกข้อมูลด้วยมือ

ถ้าให้ผู้ใช้พิมพ์ข้อมูลเองจะเกิดปัญหา:
1. พิมพ์ชื่อยาผิด
2. ลืมวิธีใช้ยา
3. เพิ่มภาระการใช้งาน โดยเฉพาะกลุ่มเป้าหมายของระบบ

### 6.3 แนวคิด Hybrid Scan

ระบบจึงเลือกใช้ 2 วิธีร่วมกัน:
1. Barcode/QR สำหรับระบุตัวสินค้าที่อ่านได้เร็วและแม่น
2. OCR สำหรับอ่านข้อความฉลากที่เป็นคำสั่งการใช้ยา

ข้อดีคือ:
1. เร็วเมื่อบาร์โค้ดมีข้อมูล
2. ยังทำงานต่อได้เมื่อบาร์โค้ดใช้ไม่ได้
3. ดึงข้อมูลเชิงคลินิกจากฉลากได้ลึกกว่า barcode

---

## 7) เทคโนโลยีที่ใช้พัฒนา

อ้างอิงจาก `package.json` และโครงสร้างโปรเจกต์:

### 7.1 Frontend
1. Next.js 16.2.4
2. React 19.2.4
3. TypeScript
4. Tailwind CSS v4
5. shadcn/ui และ `@base-ui/react`

### 7.2 OCR และการสแกน
1. `tesseract.js` สำหรับ OCR ภาษาไทยและอังกฤษ
2. `BarcodeDetector` เป็น engine หลักเมื่อ browser รองรับ
3. `@zxing/browser` เป็น fallback scanner

### 7.3 Backend/API
1. Next.js Route Handlers
2. Zod สำหรับ validate request payload

### 7.4 ฐานข้อมูลและความปลอดภัย
1. Supabase Auth
2. Supabase Postgres
3. Supabase RLS

### 7.5 External Services
1. OpenFDA สำหรับค้นหาข้อมูลยาเสริม
2. Twilio สำหรับ SMS จริง
3. Mock SMS สำหรับกรณีไม่มี provider จริง

### 7.6 Testing และ Deployment
1. Vitest
2. Playwright
3. Vercel Cron
4. Vercel deployment configuration

---

## 8) เหตุผลที่เลือกเทคโนโลยีชุดนี้

1. Next.js เหมาะกับงานเว็บที่ต้องมีทั้ง UI และ API ใน repository เดียว
2. TypeScript ลดความผิดพลาดของข้อมูลระหว่าง frontend, API, และ database
3. Supabase เหมาะกับระบบที่ต้องมี Auth + Postgres + RLS ครบในที่เดียว
4. Tesseract.js ทำให้ OCR ทำงานในเว็บได้โดยไม่ต้องพึ่งบริการภายนอกเสมอไป
5. OpenFDA เป็นแหล่งข้อมูลภายนอกที่ใช้เติมข้อมูลยาเมื่อ local catalog ยังไม่พอ
6. Vercel Cron เหมาะกับงานแจ้งเตือนเป็นรอบเวลา

---

## 9) ลำดับการพัฒนาระบบตั้งแต่ 0

หมายเหตุ:
หัวข้อนี้เป็น “ลำดับการพัฒนาที่สอดคล้องกับโครงสร้างไฟล์และประวัติ migration” ซึ่งอ้างอิงจาก repository ปัจจุบันและสามารถใช้เขียนเล่มรายงานได้อย่างสมเหตุสมผล

### 9.1 ระยะที่ 1: วิเคราะห์ปัญหาและออกแบบขอบเขต

เริ่มจากการนิยามปัญหาว่าระบบต้องช่วยใครและช่วยอย่างไร:
1. ผู้ใช้หลักคือผู้พิการทางสายตาและผู้ต้องกินยาต่อเนื่อง
2. งานหลักคือการอ่านฉลากยาและช่วยเตือน
3. ต้องมีบทบาทแพทย์และผู้ดูแลระบบร่วมในกระบวนการ

ผลของระยะนี้คือการกำหนด scope หลักของระบบ:
1. Auth และ role
2. Onboarding
3. Scan medicine
4. Medication plan
5. Reminders
6. Doctor/admin workflows

### 9.2 ระยะที่ 2: วางเทคโนโลยีพื้นฐาน

หลังจากกำหนด scope จึงเลือก stack ดังนี้:
1. Next.js เป็นแกนเว็บ
2. React + TypeScript สำหรับ UI และ type safety
3. Supabase เป็น Auth + DB
4. Tailwind/shadcn สำหรับ UI
5. Tesseract.js + barcode tools สำหรับ scanning

### 9.3 ระยะที่ 3: เริ่มโปรเจกต์เว็บ

ระบบถูกวางเป็นเว็บแอปโครงสร้างแบบ App Router โดยมี:
1. root layout
2. global styles
3. landing page
4. auth pages
5. protected app shell

ในชั้นนี้เริ่มกำหนดโครงหน้าหลักของเว็บและ shared UI เช่น buttons, cards, dialogs, tables

### 9.4 ระยะที่ 4: วางฐานข้อมูลเวอร์ชันแรก

เริ่มจาก migration `0001_careguideai.sql` เพื่อสร้าง:
1. profiles
2. medicines
3. medication plans
4. reminder events
5. doctor messages
6. appointments
7. audit logs

พร้อมทั้งสร้าง:
1. enum types
2. indexes
3. triggers
4. RLS policies

นี่เป็นฐานสำคัญที่ทำให้ระบบพร้อมสำหรับ auth, role, และการเชื่อมข้อมูลเชิงโดเมน

### 9.5 ระยะที่ 5: ทำระบบ Auth และ RBAC

หลังมีฐานข้อมูลแล้วจึงเชื่อม:
1. Supabase Auth
2. auto profile creation ผ่าน trigger
3. session handling ฝั่ง server
4. route guard ผ่าน `src/proxy.ts`
5. role checks ผ่าน `requireRole` และ `getApiAuthContext`

### 9.6 ระยะที่ 6: สร้าง onboarding ด้านสุขภาพ

ต่อมามีการเพิ่ม `user_onboarding_profiles` ผ่าน migration 0002, 0003, 0005 เพื่อเก็บ:
1. ประเภทความพิการ
2. ระดับความรุนแรง
3. โรคประจำตัว
4. ยาประจำ
5. การแพ้ยา
6. ข้อมูล BMI และ biological sex
7. ความต้องการด้าน accessibility

จากนั้น `proxy.ts` ถูกออกแบบให้ onboarding เป็นเงื่อนไขก่อนเข้าหน้าหลักของระบบ

### 9.7 ระยะที่ 7: สร้างระบบสแกนยา

ฟีเจอร์นี้ถูกพัฒนาเป็นหัวใจของระบบ:
1. สแกน barcode ก่อน
2. ถ้าไม่พอให้ใช้ OCR
3. ตรวจคุณภาพภาพก่อนยืนยัน
4. parse ข้อความฉลากเป็นข้อมูลเชิงโครงสร้าง
5. จับคู่กับฐานยา local หรือ OpenFDA

ขั้นนี้ทำให้เว็บเปลี่ยนจาก “ระบบบันทึกยา” เป็น “ระบบช่วยอ่านยา”

### 9.8 ระยะที่ 8: สร้างแผนยาและระบบเตือน

หลังระบุตัวยาได้ จึงสร้าง:
1. medication plans
2. schedule times
3. reminder events
4. dispatch logic
5. cleanup jobs

ต่อมาจึงขยาย schema ผ่าน migration 0004 และ 0006 เพื่อรองรับ:
1. cancelled reminders
2. policy แบบ until_exhausted / until_date
3. จำนวนเม็ดยาและการติดตามยาคงเหลือ

### 9.9 ระยะที่ 9: เพิ่ม blood pressure OCR

ฟีเจอร์นี้เป็นการต่อยอดแนวคิด OCR จากฉลากยาไปสู่สุขภาพเชิงตัวเลข:
1. อ่าน systolic/diastolic/pulse
2. ประเมินระดับความดัน
3. เชื่อมกับข้อมูล BMI
4. เก็บประวัติลงฐานข้อมูล

### 9.10 ระยะที่ 10: เพิ่ม doctor workflow

เมื่อ patient flow พร้อมแล้ว จึงเพิ่มหน้าของ doctor:
1. ดูคนไข้ในความดูแล
2. ดู adherence trend
3. ดูข้อความจากผู้ป่วย
4. จัดการนัดหมาย
5. ตอบ support cases

### 9.11 ระยะที่ 11: เพิ่ม admin workflow

จากนั้นเพิ่ม admin dashboard เพื่อให้ระบบบริหารจัดการได้จริง:
1. assign role
2. invite doctor
3. assign patient-doctor
4. ดู invite, audit logs, reminder failures, missed doses

### 9.12 ระยะที่ 12: เพิ่ม reliability และ compatibility

จากโค้ดใน repository จะเห็นว่าระบบถูกทำให้ทนต่อสถานการณ์จริงมากขึ้น เช่น:
1. schema fallback
2. retry logic
3. bootstrap SQL
4. legacy compatibility

สิ่งนี้สะท้อนว่าระบบไม่ได้ออกแบบแค่ให้ “ทำงานได้ตอนแรก” แต่ต้อง “ทนกับการเปลี่ยน schema ระหว่างทาง” ด้วย

### 9.13 ระยะที่ 13: ทดสอบและเตรียม deploy

สุดท้ายจึงเสริม:
1. unit tests
2. scheduling tests
3. OCR parsing tests
4. e2e tests
5. Vercel cron config
6. env configuration สำหรับ production

---

## 10) โครงสร้างหน้าเว็บที่ผู้ใช้เห็น

จาก `src/app` ระบบมีหน้าเว็บหลักดังนี้:

### 10.1 Public Pages
1. `/` หน้าแรกของเว็บ อธิบายจุดเด่นของระบบ
2. `/login` หน้าเข้าสู่ระบบ
3. `/register` หน้าสมัครสมาชิก

### 10.2 Protected Entry
1. `/app` จุดเริ่มต้นหลังล็อกอิน
2. หน้า นี้จะ redirect ไปตาม role

### 10.3 Shared Protected Pages
1. `/app/onboarding` กรอกข้อมูลเริ่มต้น
2. `/app/profile` ดูข้อมูลโปรไฟล์
3. `/app/scan` หน้าเลือกงานสแกน

### 10.4 Patient Pages
1. `/app/patient` dashboard หลักของผู้ป่วย
2. `/app/scan/medicine` สแกนยา
3. `/app/scan/blood-pressure` สแกนค่าความดัน

### 10.5 Doctor Page
1. `/app/doctor` dashboard ของแพทย์

### 10.6 Admin Page
1. `/app/admin` dashboard ของผู้ดูแลระบบ

---

## 11) โครงสร้างการใช้งานของเว็บตามบทบาท

### 11.1 Patient User Journey

1. สมัครสมาชิก
2. ล็อกอิน
3. ทำ onboarding
4. เข้าหน้า dashboard ผู้ป่วย
5. สแกนยา
6. ตรวจผล OCR
7. ยืนยันและสร้างแผนยา
8. ระบบสร้าง reminders
9. ผู้ใช้ดู reminder events และ acknowledge/cancel ได้
10. ถ้าต้องการความช่วยเหลือ สามารถส่งข้อความ เปิด support case หรือสร้างนัดหมายได้

### 11.2 Doctor User Journey

1. เข้าระบบด้วยบัญชีที่ได้รับสิทธิ์
2. ดู dashboard แพทย์
3. ดูคนไข้ในความดูแล
4. ดูแนวโน้ม adherence
5. ตอบข้อความหรือ support case
6. เสนอเวลานัดและปิดงานนัด

### 11.3 Admin User Journey

1. เข้าระบบด้วยบัญชี admin
2. ดูสถานะโดยรวมของระบบ
3. เชิญแพทย์เข้าระบบ
4. assign role ให้ผู้ใช้
5. assign ผู้ป่วยกับแพทย์
6. ตรวจ audit logs และรายการที่ต้องติดตาม

---

## 12) สถาปัตยกรรมระบบโดยรวม

ระบบแบ่งออกเป็น 4 ชั้นหลัก:

### 12.1 Presentation Layer

รับผิดชอบ UI และ interaction ทั้งหมด:
1. pages
2. dashboard
3. forms
4. scanner components
5. accessibility controls

### 12.2 Application/API Layer

รับผิดชอบ orchestration:
1. validate request
2. auth check
3. call business logic
4. query/insert/update database
5. call external integrations

### 12.3 Domain Logic Layer

รวมตรรกะเฉพาะทาง:
1. OCR parsing
2. blood pressure parsing
3. schedule normalization
4. reminder dispatch window logic
5. support-case schema recovery
6. appointment compatibility logic

### 12.4 Data Layer

ประกอบด้วย:
1. Supabase Auth
2. Postgres tables
3. enums
4. triggers
5. RLS policies
6. indexes

External systems ที่เชื่อมกับ Data/Application layer:
1. OpenFDA
2. Twilio
3. Vercel Cron

---

## 13) โครงสร้างโค้ดใน repository

### 13.1 `src/app`
เก็บ pages, layouts, loading states และ API routes ทั้งหมด

### 13.2 `src/components`
แยก component ตามโดเมน:
1. `auth`
2. `patient`
3. `doctor`
4. `admin`
5. `layout`
6. `shared`
7. `accessibility`
8. `ui`

### 13.3 `src/lib`
ศูนย์รวม business logic:
1. `auth`
2. `api`
3. `supabase`
4. `scan`
5. `reminders`
6. `medications`
7. `patient`
8. `voice`
9. `support-case`
10. `appointment`

### 13.4 `src/types`
เก็บ type definitions ของ domain ต่าง ๆ

### 13.5 `supabase/migrations`
เก็บประวัติ schema change ของฐานข้อมูล

### 13.6 `e2e`
เก็บชุดทดสอบ Playwright

---

## 14) End-to-End Flow การทำงานของเว็บ

### 14.1 Auth และ Profile Bootstrap

1. ผู้ใช้ล็อกอินผ่าน Supabase
2. trigger ใน DB สร้าง profile อัตโนมัติ
3. `proxy.ts` ตรวจ session + role

### 14.2 Onboarding Gate

1. เมื่อเข้า `/app/*` ระบบเช็ค onboarding profile
2. ถ้ายังไม่มี จะถูกบังคับไป `/app/onboarding`
3. ถ้ามีแล้ว จะไปหน้าตาม role

### 14.3 Scan -> Plan -> Reminder

1. ผู้ใช้สแกนยา
2. OCR/Barcode วิเคราะห์ข้อมูล
3. ผู้ใช้ตรวจสอบผล
4. ระบบสร้าง medication plan
5. ระบบสร้าง medication schedule times
6. ระบบสร้าง reminder events
7. cron dispatch ดึง pending reminders ไปส่งจริง

### 14.4 Support / Appointment / Follow-up

1. ผู้ป่วยสร้างข้อความ เคสช่วยเหลือ หรือคำขอนัด
2. แพทย์เห็นข้อมูลตามสิทธิ์
3. ระบบอัปเดตสถานะนัดหรือเคสในฐานข้อมูล

---

## 15) Medication Scanning Pipeline แบบละเอียด

อ้างอิงจาก:
1. `src/components/patient/medication-scanner.tsx`
2. `src/lib/scan/ocr.ts`
3. `src/app/api/scan/barcode/route.ts`
4. `src/app/api/scan/ocr/route.ts`

### 15.1 Barcode path

1. เปิดกล้อง
2. ถ้า browser รองรับ `BarcodeDetector` จะใช้ก่อน
3. ถ้าไม่รองรับ fallback ไป ZXing
4. เมื่อเจอบาร์โค้ด ระบบเรียก `/api/scan/barcode`
5. API ค้นใน local `medicines`
6. ถ้าไม่เจอ ไป OpenFDA
7. บันทึก `scan_sessions`

### 15.2 OCR path

1. สร้าง OCR worker จาก `tesseract.js`
2. โหลดภาษาไทยและอังกฤษ
3. อ่านข้อความจากภาพ
4. ประเมิน quality และ safety
5. parse ข้อความให้เป็น fields เชิงโครงสร้าง
6. validate confidence
7. ส่งข้อความไป `/api/scan/ocr`
8. API จับคู่กับ local/OpenFDA และส่ง structured result กลับ

### 15.3 Safety Gate

ระบบจะไม่ยอม auto finalize ง่าย ๆ หาก:
1. ภาพมืดเกินไป
2. ภาพสว่างเกินหรือมี glare
3. ภาพเบลอ
4. ชื่อยาไทย/อังกฤษไม่ชัด
5. score รวมต่ำเกิน threshold

จุดนี้สำคัญมากในเชิงรายงาน เพราะเป็นหลักฐานว่าระบบไม่เชื่อ OCR แบบไม่มีเงื่อนไข

### 15.4 Parsed Fields ที่ระบบดึงได้

1. ชื่อยาอังกฤษ
2. ชื่อยาไทย
3. query สำหรับค้นยา
4. ข้อความวิธีใช้ยา
5. จำนวนยาต่อครั้ง
6. ความถี่ต่อวัน
7. before/after meal
8. ช่วงเวลาในวัน
9. custom times
10. จำนวนเม็ดในซอง
11. สัญญาณว่ายาเป็นยาตามแพทย์สั่งหรือไม่

---

## 16) การสร้าง Medication Plan และ Reminder

อ้างอิง `src/app/api/medication-plans/route.ts`

### 16.1 ข้อมูลนำเข้า

ระบบใช้ข้อมูลจาก:
1. OCR parsed text
2. medicine query
3. dosage
4. schedule presets/custom times
5. medication type
6. total pills
7. pills per dose

### 16.2 การแปลงเป็นแผนยา

ระบบจะ:
1. resolve medicine จาก local/OpenFDA
2. normalize schedule times
3. สร้างแถวใน `medication_plans`
4. สร้างแถวใน `medication_schedule_times`

### 16.3 Reminder Modes

1. `until_exhausted`
- ใช้กับ prescription เป็นหลัก
- ต้องมี `total_pills`
- ระบบคำนวณจำนวน dose ตาม `pills_per_dose`

2. `until_date`
- ใช้กับ OTC หรือกรณีกำหนดวันสิ้นสุด
- ระบบสร้าง slot จนถึงวันที่กำหนด

### 16.4 Reminder Events

ระบบสร้าง event แยกตาม channel:
1. sms
2. voice

ทุก event ผูกกับ:
1. patient
2. plan
3. due time
4. status
5. provider

---

## 17) Reminder Runtime และ Cron

### 17.1 Dispatch

จาก `/api/reminders/dispatch`

ระบบจะ:
1. ดึง pending reminders ในหน้าต่างเวลา
2. ตรวจว่าแผนยายัง active อยู่หรือไม่
3. ถ้า plan inactive จะ auto cancel
4. ถ้าถึงเวลาส่งจริง จะส่ง SMS ผ่าน provider ที่เลือก
5. update `sent` หรือ `failed`

### 17.2 Cleanup

จาก:
1. `/api/reminders/cleanup-cancelled`
2. `/api/reminders/cleanup`

ระบบลบข้อมูลที่หมดอายุหรือไม่จำเป็นออกตาม policy

### 17.3 Cron Schedule

จาก `vercel.json`
1. dispatch ทุก 5 นาที
2. cleanup-cancelled ทุก 30 นาที
3. cleanup รายสัปดาห์

---

## 18) Blood Pressure OCR Subsystem

อ้างอิง:
1. `src/components/patient/blood-pressure-scanner.tsx`
2. `src/lib/scan/blood-pressure.ts`
3. `src/app/api/scan/blood-pressure/route.ts`

### 18.1 แนวคิด

ระบบนี้ใช้แนวคิดคล้าย OCR ยา แต่เปลี่ยนเป้าหมายจาก “ข้อความฉลาก” เป็น “ตัวเลขค่าความดัน”

### 18.2 ข้อมูลที่ parse

1. systolic
2. diastolic
3. pulse

### 18.3 รูปแบบที่ parser รองรับ

1. labeled (`SYS`, `DIA`)
2. ratio (`120/80`)
3. line-based parsing
4. number-sequence fallback
5. normalization ตัวเลขไทยและตัวอักษรที่ OCR มักอ่านผิด

### 18.4 การประเมินผล

หลัง parse ได้ ระบบจะจัดระดับ:
1. normal
2. elevated
3. high_stage_1
4. high_stage_2
5. hypertensive_crisis

พร้อมสรุปภาษาไทยและเชื่อมกับแนวโน้ม BMI หากมีข้อมูล

---

## 19) Doctor Workflow และ Admin Workflow

### 19.1 Doctor Workflow

จาก `src/app/app/doctor/page.tsx` แพทย์สามารถ:
1. ดูจำนวนคนไข้ในความดูแล
2. ดูข้อความล่าสุด
3. ดูคำขอนัดหมาย
4. ดู adherence chart
5. ตอบ support cases
6. เสนอนัดหรือ complete นัด

### 19.2 Admin Workflow

จาก `src/app/app/admin/page.tsx` ผู้ดูแลระบบสามารถ:
1. ดูจำนวน users ตาม role
2. ดู onboarding coverage
3. ดู active plans
4. ดู pending/failed reminders
5. เชิญแพทย์
6. assign role
7. assign patient-doctor
8. ดู audit logs
9. ดู failed reminders, missed doses, pending appointments

---

## 20) แผนที่ API ของระบบ

### 20.1 Auth
1. `POST /api/auth/register`

### 20.2 Scan
1. `POST /api/scan/barcode`
2. `POST /api/scan/ocr`
3. `GET|POST /api/scan/blood-pressure`

### 20.3 Medication
1. `POST /api/medication-plans`
2. `GET /api/medicines/search`

### 20.4 Reminders
1. `GET|POST /api/reminders/dispatch`
2. `POST /api/reminders/ack`
3. `POST /api/reminders/cancel`
4. `GET|POST /api/reminders/cleanup`
5. `GET|POST /api/reminders/cleanup-cancelled`
6. `GET /api/reminders/pending`

### 20.5 Adherence
1. `POST /api/adherence/log`

### 20.6 Profile / Onboarding
1. `POST /api/profile/onboarding`

### 20.7 Doctor Communication
1. `POST /api/doctor/messages`

### 20.8 Support Cases
1. `GET|POST /api/support/cases`
2. `POST /api/support/cases/[caseId]/accept`
3. `POST /api/support/cases/[caseId]/close`
4. `GET|POST /api/support/cases/[caseId]/messages`

### 20.9 Appointments
1. `GET|POST|PATCH /api/appointments`

### 20.10 Admin
1. `POST /api/admin/invite-doctor`
2. `POST /api/admin/assign-role`
3. `POST /api/admin/assign-patient-doctor`

---

## 21) โครงสร้างฐานข้อมูลเชิงแนวคิด

### 21.1 กลุ่มข้อมูลผู้ใช้
1. `profiles`
2. `doctor_invites`
3. `patient_doctor_links`

### 21.2 กลุ่มข้อมูลยา
1. `medicines`
2. `medication_plans`
3. `medication_schedule_times`

### 21.3 กลุ่มข้อมูลการสแกนและการกินยา
1. `scan_sessions`
2. `adherence_logs`
3. `blood_pressure_readings`

### 21.4 กลุ่มข้อมูลเตือน
1. `reminder_events`

### 21.5 กลุ่มข้อมูลสื่อสารและดูแลรักษา
1. `doctor_messages`
2. `support_cases`
3. `support_case_messages`
4. `appointments`

### 21.6 กลุ่มข้อมูลกำกับดูแล
1. `admin_audit_logs`

---

## 22) อธิบาย SQL Migrations ทุกไฟล์

### 22.1 `0001_careguideai.sql`
สร้างฐานหลักของระบบ:
1. enums หลัก
2. tables หลัก
3. indexes
4. functions
5. triggers
6. RLS policies

### 22.2 `0002_user_onboarding_profiles.sql`
เพิ่มตาราง onboarding สุขภาพและ accessibility

### 22.3 `0003_user_onboarding_normal_user_option.sql`
ปรับ enum onboarding ให้รองรับผู้ใช้ที่ไม่มีความพิการ

### 22.4 `0004_reminder_events_cleanup_and_cancel.sql`
เพิ่ม cancelled reminders และ index ที่เกี่ยวข้อง

### 22.5 `0005_onboarding_add_biological_sex.sql`
เพิ่ม biological sex เพื่อสนับสนุนการวิเคราะห์สุขภาพ

### 22.6 `0006_medication_scan_inventory_and_policy.sql`
เพิ่มนโยบายยา, stock fields, reminder modes

### 22.7 `0007_blood_pressure_readings.sql`
เพิ่ม subsystem สำหรับเก็บค่าความดัน

### 22.8 `0008_support_cases_realtime_chat.sql`
เพิ่ม support cases และ chat tables

### 22.9 `0009_support_case_open_request_policy.sql`
ปรับนโยบายการเปิดเคสให้สอดคล้องกับ doctor selection

### 22.10 `0010_appointment_doctor_confirmation_flow.sql`
เพิ่ม flow นัดหมายแบบ confirmation

### 22.11 `0011_appointments_rls_patient_update_fix.sql`
แก้ RLS ให้ patient update นัดที่เกี่ยวข้องกับตนเองได้

---

## 23) Security Architecture

### 23.1 Authentication
ใช้ Supabase Auth เป็นแกนหลัก

### 23.2 Authorization
บังคับ 3 ชั้น:
1. route guard
2. API auth guard
3. database RLS

### 23.3 Principle of Least Privilege
1. patient เห็นเฉพาะข้อมูลตนเอง
2. doctor เห็นเฉพาะคนไข้ที่เกี่ยวข้อง
3. admin มีสิทธิ์สูงสุดตาม policy

### 23.4 Cron Security
cron endpoints ใช้ `CRON_SECRET` หรือ admin session

---

## 24) Reliability และ Fault Tolerance

ระบบนี้มีจุดเด่นเรื่องความทนทานต่อการเปลี่ยน schema และสภาพแวดล้อมจริง:
1. medication plan compatibility fallback
2. appointment schema recovery
3. support case retry/bootstrap
4. blood pressure fallback storage
5. legacy reminder cancel compatibility

แนวคิดคือ “ระบบไม่ควรล้มทั้ง flow เพราะ schema cache ยังไม่อัปเดตชั่วคราว”

---

## 25) Accessibility-by-Design

จาก `src/components/accessibility/accessibility-assistant.tsx` และ voice modules ระบบรองรับ:
1. Thai TTS
2. อ่านชื่อปุ่มเมื่อกด
3. large text mode
4. high contrast mode
5. local preference storage

สำหรับ scanner ยังมี voice guidance ระหว่างการเล็งกล้องและตรวจผล

---

## 26) การตั้งค่าและการเริ่มรันระบบ

### 26.1 Environment Variables สำคัญ

1. Supabase
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

2. App
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_APP_URL`
- `APP_TIMEZONE`

3. Integrations
- `OPENFDA_API_BASE_URL`
- `OPENFDA_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_PHONE`

4. Cron / Direct DB
- `CRON_SECRET`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`

### 26.2 การเริ่มระบบในเชิงปฏิบัติ

1. ตั้งค่า `.env.local`
2. เตรียม Supabase project
3. รัน migrations ตามลำดับ
4. กำหนด admin คนแรก
5. ติดตั้ง dependencies
6. รัน dev server
7. ทดสอบ scan, reminder, และ dashboards

---

## 27) Testing และคุณภาพของระบบ

ชุดทดสอบที่มีใน repository ช่วยยืนยัน logic สำคัญ:
1. OCR parsing ของยา
2. schedule normalization
3. reminder engine
4. RBAC
5. E2E ผ่าน Playwright

นี่เป็นหลักฐานว่าโครงการมีการออกแบบเชิงวิศวกรรม ไม่ใช่เพียงทำหน้าเว็บให้ใช้งานได้

---

## 28) จุดแข็งของระบบ

1. ใช้ Hybrid Scan ที่เหมาะกับโลกจริง
2. ไม่เชื่อ OCR แบบไม่มีเงื่อนไข แต่มี safety gate และ human confirmation
3. แยกสิทธิ์ผู้ใช้ชัดเจนและบังคับถึงระดับฐานข้อมูล
4. รองรับทั้ง patient, doctor, admin ในระบบเดียว
5. มี cron, cleanup, retry, fallback ทำให้ระบบใช้งานต่อเนื่องได้ดี
6. ออกแบบเรื่อง accessibility ตั้งแต่ต้น

---

## 29) ข้อจำกัดของระบบ

1. OCR ยังขึ้นกับคุณภาพภาพมาก
2. ชื่อการค้าและฉลากยาไทยมีความหลากหลายสูง
3. OpenFDA ไม่ครอบคลุมข้อมูลยาไทยทั้งหมด
4. ระบบยังไม่วิเคราะห์ interaction ระหว่างยาหลายตัวเชิงลึก
5. ยังเป็นระบบช่วยตัดสินใจ ไม่ใช่ระบบวินิจฉัยแทนแพทย์

---

## 30) แนวทางพัฒนาต่อ

1. เพิ่ม knowledge base ยาไทยแบบ curated
2. เพิ่ม drug interaction checker
3. เพิ่ม analytics ของ OCR precision/recall
4. เพิ่ม monitoring และ observability ของ cron workflows
5. เพิ่มฟีเจอร์ติดตามสุขภาพเชิง longitudinal มากขึ้น

---

## 31) สรุปเชิงรายงาน

ถ้าจะนำเอกสารนี้ไปเขียนเล่มรายงาน ตอนนี้เนื้อหาครอบคลุมหัวข้อสำคัญแล้ว ได้แก่:
1. ที่มาของปัญหา
2. วัตถุประสงค์
3. ขอบเขต
4. กลุ่มผู้ใช้
5. เหตุผลเลือก OCR และเทคโนโลยี
6. ลำดับการพัฒนาระบบตั้งแต่ 0
7. โครงสร้างเว็บและสถาปัตยกรรม
8. ลำดับการทำงานของระบบ
9. โครงสร้างฐานข้อมูลและ migrations
10. ความปลอดภัย ความทนทาน และการทดสอบ

ดังนั้นไฟล์นี้สามารถใช้เป็น “เอกสารแม่” สำหรับแตกไปเป็นบทในรายงานได้แล้ว โดยเฉพาะบท:
1. บทนำและปัญหา
2. การวิเคราะห์และออกแบบระบบ
3. การพัฒนาและเทคโนโลยีที่ใช้
4. การทำงานของระบบ
5. การทดสอบและสรุปผล

---

## 32) ข้อกำหนดของระบบที่สรุปได้จากการพัฒนา

เพื่อให้เอกสารนี้นำไปใช้ในเล่มรายงานได้ง่ายขึ้น สามารถสรุปข้อกำหนดของระบบได้ดังนี้

### 32.1 Functional Requirements

1. ระบบต้องให้ผู้ใช้สมัครสมาชิกและเข้าสู่ระบบได้
2. ระบบต้องรองรับการกำหนดบทบาทผู้ใช้เป็น patient, doctor และ admin
3. ระบบต้องบังคับให้ผู้ใช้กรอก onboarding ก่อนเข้าถึงฟังก์ชันหลัก
4. ระบบต้องให้ patient สแกนฉลากยาได้ทั้งแบบ barcode/QR และ OCR
5. ระบบต้องแปลงผลการสแกนยาเป็นข้อมูลเชิงโครงสร้างที่ใช้สร้างแผนยาได้
6. ระบบต้องให้ผู้ใช้ตรวจทานและยืนยันข้อมูลยาก่อนบันทึกแผนยา
7. ระบบต้องสร้าง medication plan และ schedule จากข้อมูลยาที่ได้รับ
8. ระบบต้องสร้าง reminder events และแจ้งเตือนตามเวลาที่กำหนดได้
9. ระบบต้องรองรับการบันทึกการกินยาและติดตาม adherence
10. ระบบต้องให้ผู้ใช้สแกนค่าความดันโลหิตและบันทึกประวัติได้
11. ระบบต้องให้ patient สื่อสารกับ doctor และเปิด support case ได้
12. ระบบต้องให้ doctor ดูข้อมูลผู้ป่วยที่เกี่ยวข้อง ตอบข้อความ และจัดการนัดหมายได้
13. ระบบต้องให้ admin จัดการ role, invite doctor และเชื่อม patient-doctor ได้
14. ระบบต้องมี API สำหรับ dispatch, cancel และ cleanup reminder events

### 32.2 Non-Functional Requirements

1. ระบบต้องมีความปลอดภัยของข้อมูลผู้ใช้และข้อมูลสุขภาพผ่าน authentication, authorization และ RLS
2. ระบบต้องรองรับการใช้งานผ่านเว็บเบราว์เซอร์สมัยใหม่บน desktop และ mobile
3. ระบบต้องออกแบบให้ผู้มีข้อจำกัดด้านการมองเห็นใช้งานได้ง่ายขึ้น
4. ระบบต้องมีความทนทานต่อข้อมูลสแกนที่ไม่สมบูรณ์ด้วย fallback และ validation
5. ระบบต้องรองรับการเตือนอัตโนมัติแบบ background ผ่าน cron jobs
6. ระบบต้องแยกความรับผิดชอบของแต่ละชั้นระบบอย่างชัดเจน เพื่อให้ดูแลรักษาและขยายต่อได้
7. ระบบต้องสามารถตรวจสอบและทดสอบฟังก์ชันหลักได้ผ่าน unit/integration/E2E test
8. ระบบต้องรองรับการ deploy ในลักษณะ production web application ได้

---

## 33) วิธีนำเอกสารนี้ไปแตกเป็นบทในเล่มรายงาน

ถ้าต้องเขียนเป็นเล่มรายงานแบบโครงงานหรือสารนิพนธ์ สามารถนำเอกสารนี้ไปแปลงเป็นแต่ละบทได้ดังนี้

### 33.1 บทที่ 1 บทนำ

ใช้จากหัวข้อ:
1. บทนำ
2. ที่มาของปัญหา
3. วัตถุประสงค์ของระบบ
4. ขอบเขตของระบบ
5. กลุ่มผู้ใช้และบทบาท

### 33.2 บทที่ 2 เอกสารและเทคโนโลยีที่เกี่ยวข้อง

ใช้จากหัวข้อ:
1. ทำไมระบบนี้ต้องใช้ OCR
2. เทคโนโลยีที่ใช้พัฒนา
3. เหตุผลที่เลือกเทคโนโลยีชุดนี้

และสามารถเสริมทฤษฎีภายนอกได้ เช่น:
1. หลักการทำงานของ OCR
2. แนวคิด barcode detection
3. แนวคิด role-based access control
4. แนวคิด relational database และ row level security

### 33.3 บทที่ 3 การวิเคราะห์และออกแบบระบบ

ใช้จากหัวข้อ:
1. โครงสร้างหน้าเว็บที่ผู้ใช้เห็น
2. โครงสร้างการใช้งานของเว็บตามบทบาท
3. สถาปัตยกรรมระบบโดยรวม
4. โครงสร้างโค้ดใน repository
5. โครงสร้างฐานข้อมูลเชิงแนวคิด
6. Security Architecture
7. ข้อกำหนดของระบบที่สรุปได้จากการพัฒนา

### 33.4 บทที่ 4 การพัฒนาและการทำงานของระบบ

ใช้จากหัวข้อ:
1. ลำดับการพัฒนาระบบตั้งแต่ 0
2. End-to-End Flow การทำงานของเว็บ
3. Medication Scanning Pipeline แบบละเอียด
4. การสร้าง Medication Plan และ Reminder
5. Reminder Runtime และ Cron
6. Blood Pressure OCR Subsystem
7. Doctor Workflow และ Admin Workflow
8. แผนที่ API ของระบบ
9. การตั้งค่าและการเริ่มรันระบบ

### 33.5 บทที่ 5 การทดสอบ สรุปผล และข้อเสนอแนะ

ใช้จากหัวข้อ:
1. Reliability และ Fault Tolerance
2. Accessibility-by-Design
3. Testing และคุณภาพของระบบ
4. จุดแข็งของระบบ
5. ข้อจำกัดของระบบ
6. แนวทางพัฒนาต่อ
7. สรุปเชิงรายงาน

---

## 34) สิ่งที่ควรแนบเพิ่มในเล่มรายงานเพื่อให้สมบูรณ์ยิ่งขึ้น

แม้เนื้อหาในไฟล์นี้จะเพียงพอสำหรับใช้เป็นแกนหลักของรายงานแล้ว แต่ถ้าต้องการให้เล่มสมบูรณ์และน่าเชื่อถือมากขึ้น ควรแนบสิ่งต่อไปนี้เพิ่มเติม

1. ภาพหน้าจอของแต่ละหน้าหลัก เช่น login, onboarding, patient dashboard, scan medicine, doctor dashboard และ admin dashboard
2. Use Case Diagram แสดง actor หลัก ได้แก่ patient, doctor และ admin
3. Activity Diagram หรือ Sequence Diagram ของ flow สำคัญ เช่น scan -> OCR -> confirm -> create plan -> create reminder
4. ER Diagram หรือ schema relationship diagram ของฐานข้อมูล
5. ตาราง mapping ระหว่าง requirement กับฟังก์ชันที่พัฒนา
6. ตารางผลการทดสอบ เช่น test case, expected result, actual result และสถานะผ่าน/ไม่ผ่าน
7. ตัวอย่างผลลัพธ์จาก OCR ทั้งกรณีอ่านได้ดีและกรณีที่ต้อง fallback หรือให้ผู้ใช้แก้ไข
8. ตารางสรุปข้อจำกัดและความเสี่ยงของระบบในสภาพแวดล้อมจริง

หากทำส่วนแนบเหล่านี้เพิ่ม จะช่วยให้รายงานไม่เพียงอธิบายว่า "ระบบถูกสร้างอย่างไร" แต่ยังอธิบายได้ชัดเจนว่า "ระบบถูกประเมินและพิสูจน์การใช้งานอย่างไร"
