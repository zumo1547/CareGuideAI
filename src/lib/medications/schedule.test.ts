import { describe, expect, it } from "vitest";

import { createRollingDateWindow, isWithinDueWindow, normalizeScheduleInput } from "@/lib/medications/schedule";

describe("normalizeScheduleInput", () => {
  it("merges preset and custom times", () => {
    const output = normalizeScheduleInput({
      presets: ["morning", "evening"],
      customTimes: ["10:30", "22:00"],
    });

    expect(output).toHaveLength(4);
    expect(output.map((item) => item.time24)).toEqual(["08:00", "10:30", "19:00", "22:00"]);
  });

  it("drops invalid custom times", () => {
    const output = normalizeScheduleInput({
      presets: [],
      customTimes: ["25:10", "12:xx", "09:15"],
    });
    expect(output).toEqual([{ label: "กำหนดเอง", source: "custom", time24: "09:15" }]);
  });
});

describe("due window helpers", () => {
  it("returns true when inside interval", () => {
    const now = new Date("2026-01-01T08:03:00.000Z");
    const dueAt = new Date("2026-01-01T08:00:00.000Z");
    expect(isWithinDueWindow({ now, dueAt })).toBe(true);
  });

  it("builds rolling date window", () => {
    const window = createRollingDateWindow(new Date("2026-01-01T00:00:00.000Z"), 3);
    expect(window).toHaveLength(3);
    expect(window[2].toISOString().startsWith("2026-01-03")).toBe(true);
  });
});
