"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const LogoutButton = () => {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleLogout = () => {
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
    });
  };

  return (
    <Button variant="outline" onClick={handleLogout} disabled={pending}>
      {pending ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
    </Button>
  );
};
