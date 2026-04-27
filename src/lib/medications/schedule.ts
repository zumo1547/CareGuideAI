import { addDays, isWithinInterval } from "date-fns";

import { PRESET_LABEL_MAP, PRESET_TIME_MAP } from "@/lib/constants";
import type { MedicationScheduleInput, SchedulePreset } from "@/types/domain";

export interface NormalizedScheduleTime {
  label: string;
  time24: string;
  source: "preset" | "custom";
}

export const normalizeScheduleInput = (
  input: MedicationScheduleInput,
): NormalizedScheduleTime[] => {
  const normalized = new Map<string, NormalizedScheduleTime>();

  input.presets.forEach((preset: SchedulePreset) => {
    const time24 = PRESET_TIME_MAP[preset];
    const label = PRESET_LABEL_MAP[preset];
    normalized.set(`${label}-${time24}`, { label, time24, source: "preset" });
  });

  input.customTimes.forEach((time24) => {
    const valid = /^([01]\d|2[0-3]):([0-5]\d)$/.test(time24);
    if (!valid) {
      return;
    }

    normalized.set(`กำหนดเอง-${time24}`, {
      label: "กำหนดเอง",
      time24,
      source: "custom",
    });
  });

  return [...normalized.values()].sort((a, b) => a.time24.localeCompare(b.time24));
};

export interface DueWindowInput {
  now: Date;
  dueAt: Date;
  earlyMinutes?: number;
  lateMinutes?: number;
}

export const isWithinDueWindow = ({
  now,
  dueAt,
  earlyMinutes = 5,
  lateMinutes = 5,
}: DueWindowInput) =>
  isWithinInterval(now, {
    start: new Date(dueAt.getTime() - earlyMinutes * 60 * 1000),
    end: new Date(dueAt.getTime() + lateMinutes * 60 * 1000),
  });

export const createRollingDateWindow = (start: Date, days = 7) =>
  Array.from({ length: days }, (_, offset) => addDays(start, offset));
