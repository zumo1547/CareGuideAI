import type { AppointmentStatus } from "@/types/domain";

export type AppointmentPatientResponse =
  | "pending"
  | "accepted"
  | "declined"
  | "reschedule_requested";

export interface AppointmentPartySummary {
  id: string;
  fullName: string | null;
  phone: string | null;
}

export interface AppointmentView {
  id: string;
  patientId: string;
  doctorId: string;
  requestedBy: string;
  requestNote: string | null;
  patientPreferredAt: string | null;
  scheduledAt: string | null;
  status: AppointmentStatus;
  doctorConfirmationLink: string | null;
  doctorConfirmationToken: string | null;
  doctorProposedNote: string | null;
  doctorProposedAt: string | null;
  patientResponse: AppointmentPatientResponse;
  patientResponseNote: string | null;
  patientRespondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  patient: AppointmentPartySummary | null;
  doctor: AppointmentPartySummary | null;
}

