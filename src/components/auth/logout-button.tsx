"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface LogoutButtonProps {
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  label?: string;
  showIcon?: boolean;
}

export const LogoutButton = ({
  className,
  variant = "outline",
  size = "default",
  label = "ออกจากระบบ",
  showIcon = false,
}: LogoutButtonProps) => {
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
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleLogout}
      disabled={pending}
      aria-label={pending ? "กำลังออกจากระบบ" : label}
    >
      {showIcon ? <LogOut className="h-4 w-4" /> : null}
      {pending ? "กำลังออกจากระบบ..." : label}
    </Button>
  );
};
