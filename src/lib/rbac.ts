import type { Role } from "@/types/domain";

const roleWeight: Record<Role, number> = {
  patient: 1,
  doctor: 2,
  admin: 3,
};

export const isRole = (value: unknown): value is Role =>
  value === "patient" || value === "doctor" || value === "admin";

export const canAccessAnyRole = (role: Role, allowed: Role[]) =>
  allowed.includes(role);

export const isAtLeastRole = (role: Role, minimumRole: Role) =>
  roleWeight[role] >= roleWeight[minimumRole];
