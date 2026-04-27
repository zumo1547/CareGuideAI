import { describe, expect, it } from "vitest";

import { canAccessAnyRole, isAtLeastRole, isRole } from "@/lib/rbac";

describe("rbac", () => {
  it("validates role values", () => {
    expect(isRole("patient")).toBe(true);
    expect(isRole("doctor")).toBe(true);
    expect(isRole("admin")).toBe(true);
    expect(isRole("guest")).toBe(false);
  });

  it("checks role allowlist", () => {
    expect(canAccessAnyRole("doctor", ["doctor", "admin"])).toBe(true);
    expect(canAccessAnyRole("patient", ["doctor", "admin"])).toBe(false);
  });

  it("checks role hierarchy", () => {
    expect(isAtLeastRole("admin", "doctor")).toBe(true);
    expect(isAtLeastRole("doctor", "patient")).toBe(true);
    expect(isAtLeastRole("patient", "doctor")).toBe(false);
  });
});
