"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadStatus } from "@/generated/prisma/enums";
import { leadStatuses, leadStatusLabels } from "@/lib/lead";

export function LeadStatusSelect({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function update(nextStatus: LeadStatus) {
    if (nextStatus === status) return;
    setSaving(true); setError("");
    const response = await fetch(`/api/leads/${leadId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setError(result.error ?? "Não foi possível alterar o status."); return; }
    router.refresh();
  }
  return <div><label htmlFor="quick-status" className="field-label">Status atual</label><select id="quick-status" className="field min-w-44" value={status} onChange={(event) => update(event.target.value as LeadStatus)} disabled={saving}>{leadStatuses.map((item) => <option key={item} value={item}>{leadStatusLabels[item]}</option>)}</select>{error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}</div>;
}
