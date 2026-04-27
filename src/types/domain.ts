export type Role = "patient" | "doctor" | "admin";

export type ReminderChannel = "sms" | "voice";

export type ScanGuidanceState =
  | "move_left"
  | "move_right"
  | "move_up"
  | "move_down"
  | "move_closer"
  | "move_away"
  | "hold_steady";

export type AppointmentStatus = "pending" | "confirmed" | "completed";

export type AdherenceStatus = "scheduled" | "taken" | "missed";

export type SchedulePreset = "morning" | "noon" | "evening";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface MedicineSearchResult {
  id?: string;
  source: "local" | "openfda";
  sourceId: string;
  name: string;
  genericName?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  barcode?: string | null;
}

export interface MedicationScheduleInput {
  presets: SchedulePreset[];
  customTimes: string[];
}

export interface ReminderDispatchResult {
  eventId: string;
  channel: ReminderChannel;
  success: boolean;
  provider: string;
  message: string;
}
