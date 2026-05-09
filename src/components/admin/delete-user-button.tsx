"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface DeleteUserButtonProps {
  userId: string;
  fullName: string;
  role: string;
  isCurrentAdmin: boolean;
}

interface DeleteUserResponse {
  error?: string;
}

export const DeleteUserButton = ({
  userId,
  fullName,
  role,
  isCurrentAdmin,
}: DeleteUserButtonProps) => {
  const router = useRouter();
  const [isDeleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    if (isCurrentAdmin || isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันลบผู้ใช้ \"${fullName}\" (${role}) ?\n\nข้อมูลผู้ใช้และข้อมูลที่เกี่ยวข้องจะถูกลบออกจากระบบ`,
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/delete-user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const payload = (await response.json()) as DeleteUserResponse;
      if (!response.ok) {
        setError(payload.error ?? "ลบผู้ใช้ไม่สำเร็จ");
        return;
      }

      window.alert("ลบผู้ใช้สำเร็จ");
      router.refresh();
    } catch {
      setError("ลบผู้ใช้ไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={onDelete}
        disabled={isCurrentAdmin || isDeleting}
      >
        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        <span>{isCurrentAdmin ? "ลบไม่ได้" : "ลบ"}</span>
      </Button>
      {error ? <p className="max-w-[220px] text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
};
