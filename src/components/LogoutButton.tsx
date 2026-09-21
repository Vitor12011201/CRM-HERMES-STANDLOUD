"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout() {
    setIsSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
      setIsSubmitting(false);
    }
  }

  return <button type="button" onClick={logout} disabled={isSubmitting} className="mt-4 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-emerald-50/75 hover:bg-white/10 hover:text-white disabled:opacity-60">{isSubmitting ? "Saindo..." : "Sair"}</button>;
}
