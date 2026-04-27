import { describe, expect, it } from "vitest";

import { makeReminderMessage, nextDueDate, shouldDispatchNow, toReminderPayload } from "@/lib/reminders/engine";

describe("reminder engine", () => {
  it("builds thai reminder message", () => {
    const text = makeReminderMessage({
      eventId: "evt_1",
      patientId: "patient_1",
      dueAt: new Date("2026-01-01T08:00:00.000Z"),
      medicineName: "Paracetamol",
      dosage: "1 เม็ด",
    });

    expect(text).toContain("Paracetamol");
    expect(text).toContain("1 เม็ด");
  });

  it("maps runtime event to payload", () => {
    const payload = toReminderPayload(
      {
        eventId: "evt_1",
        patientId: "patient_1",
        dueAt: new Date("2026-01-01T08:00:00.000Z"),
        medicineName: "Paracetamol",
        dosage: "1 เม็ด",
      },
      "sms",
    );

    expect(payload.channel).toBe("sms");
    expect(payload.message).toContain("Paracetamol");
  });

  it("checks dispatch window", () => {
    const dueAt = new Date("2026-01-01T08:00:00.000Z");
    expect(shouldDispatchNow(dueAt, new Date("2026-01-01T08:05:00.000Z"))).toBe(true);
    expect(shouldDispatchNow(dueAt, new Date("2026-01-01T08:20:00.000Z"))).toBe(false);
  });

  it("computes next due date", () => {
    const next = nextDueDate("19:00", new Date("2026-01-01T08:00:00.000Z"));
    expect(next?.getHours()).toBe(19);
  });
});
