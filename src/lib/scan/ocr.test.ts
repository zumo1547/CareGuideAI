import { describe, expect, it } from "vitest";

import { parseMedicationDetailsFromText } from "@/lib/scan/ocr";

describe("parseMedicationDetailsFromText inventory metadata", () => {
  it("extracts total pills from package marker", () => {
    const input = `Amlodipine 5 MG\nรับประทานครั้งละ 1 เม็ด\nวันละ 2 ครั้ง หลังอาหาร เช้าและเย็น\n#180 เม็ด\nยานี้ใช้ตามแพทย์สั่งเท่านั้น`;

    const parsed = parseMedicationDetailsFromText(input);

    expect(parsed.totalPillsInPackage).toBe(180);
    expect(parsed.isDoctorPrescribed).toBe(true);
  });

  it("does not confuse per-dose line as package total", () => {
    const input = `Cetirizine 10 mg\nรับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง ก่อนนอน`;

    const parsed = parseMedicationDetailsFromText(input);

    expect(parsed.quantityPerDoseValue).toBe(1);
    expect(parsed.totalPillsInPackage).toBeNull();
  });

  it("detects otc hints", () => {
    const input = `Paracetamol 500 mg\nOTC\nTake 1 tablet after meal`;

    const parsed = parseMedicationDetailsFromText(input);

    expect(parsed.isDoctorPrescribed).toBe(false);
  });
});
