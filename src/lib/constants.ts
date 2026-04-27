import type { Role, SchedulePreset } from "@/types/domain";

export const ROLE_HOME: Record<Role, string> = {
  patient: "/app/patient",
  doctor: "/app/doctor",
  admin: "/app/admin",
};

export const PROTECTED_ROUTES = ["/app"];

export const ROLE_GUARDED_ROUTES: Record<string, Role[]> = {
  "/app/patient": ["patient", "admin"],
  "/app/doctor": ["doctor", "admin"],
  "/app/admin": ["admin"],
  "/app/scan": ["patient", "admin"],
};

export const PRESET_TIME_MAP: Record<SchedulePreset, string> = {
  morning: "08:00",
  noon: "13:00",
  evening: "19:00",
};

export const PRESET_LABEL_MAP: Record<SchedulePreset, string> = {
  morning: "เช้า",
  noon: "กลางวัน",
  evening: "เย็น",
};
