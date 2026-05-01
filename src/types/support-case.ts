export type SupportCaseStatus = "pending" | "active" | "closed";

export interface SupportCasePatientInfo {
  id: string;
  fullName: string;
  phone: string | null;
  disabilityType: string | null;
  disabilitySeverity: string | null;
  chronicConditions: string | null;
  drugAllergies: string | null;
  bmi: number | null;
  biologicalSex: string | null;
}

export interface SupportCaseDoctorInfo {
  id: string;
  fullName: string;
  phone: string | null;
}

export interface SupportCaseSummary {
  id: string;
  patientId: string;
  requestedDoctorId: string;
  assignedDoctorId: string | null;
  requestMessage: string;
  status: SupportCaseStatus;
  requestedAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  updatedAt: string;
  patient: SupportCasePatientInfo | null;
  requestedDoctor: SupportCaseDoctorInfo | null;
  assignedDoctor: SupportCaseDoctorInfo | null;
}

export interface SupportCaseMessage {
  id: string;
  caseId: string;
  senderId: string;
  senderName: string;
  senderRole: string | null;
  message: string;
  createdAt: string;
}
