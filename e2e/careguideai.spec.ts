import { expect, test } from "@playwright/test";

const hasSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

test.describe("CareGuideAI MVP routing", () => {
  test("landing page shows key sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("CareGuideAI")).toBeVisible();
    await expect(page.getByText("ผู้ช่วยอัจฉริยะ")).toBeVisible();
    await expect(page.getByRole("link", { name: "เริ่มใช้งาน" })).toBeVisible();
  });

  test("login and register pages load", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("เข้าสู่ระบบ CareGuideAI")).toBeVisible();
    await page.goto("/register");
    await expect(page.getByText("สมัครใช้งาน CareGuideAI")).toBeVisible();
  });

  test("protected route redirects to login when unauthenticated", async ({ page }) => {
    test.skip(!hasSupabaseEnv, "Needs Supabase env for proxy auth check");
    await page.goto("/app/patient");
    await expect(page).toHaveURL(/\/login/);
  });
});
