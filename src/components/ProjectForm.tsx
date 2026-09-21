"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { projectStatusLabels, projectStatuses } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";
import { FieldError, FormMessage } from "./FormMessage";

export type LeadOption = { id: string; companyName: string };
export type ProjectFormData = { id?: string; leadId?: string | null; clientName: string; projectName: string; totalAmountCents: number; status: ProjectStatus; startDate?: Date | string | null; completionDate?: Date | string | null; notes?: string | null };

function displayAmount(cents?: number) { return cents ? (cents / 100).toFixed(2) : ""; }

export function moneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/R\$|\s/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function ProjectForm({ leads, initial, onSaved }: { leads: LeadOption[]; initial?: ProjectFormData; onSaved?: () => void }) {
  const router = useRouter(); const [errors, setErrors] = useState<Record<string, string[] | undefined>>({}); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id); const value = initial ?? { clientName: "", projectName: "", totalAmountCents: 0, status: "ACTIVE" as ProjectStatus };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const cents = moneyToCents(String(data.totalAmount));
    if (!cents) { setErrors({ totalAmount: ["Informe um valor positivo, por exemplo 1290,00."] }); return; }
    delete data.totalAmount; const payload = { ...data, totalAmountCents: cents };
    setSaving(true); setErrors({}); setMessage("");
    const response = await fetch(editing ? `/api/projects/${initial?.id}` : "/api/projects", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setMessage(result.error ?? "Não foi possível salvar o projeto."); setErrors(result.fields ?? {}); return; }
    if (!editing) form.reset(); setMessage(editing ? "Projeto atualizado." : "Projeto criado."); router.refresh(); onSaved?.();
  }
  return <form onSubmit={submit} noValidate className="space-y-4"><FormMessage message={message} /><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor={editing ? "edit-clientName" : "clientName"}>Cliente *</label><input className="field" id={editing ? "edit-clientName" : "clientName"} name="clientName" required defaultValue={value.clientName} /><FieldError errors={errors} name="clientName" /></div><div><label className="field-label" htmlFor={editing ? "edit-projectName" : "projectName"}>Projeto *</label><input className="field" id={editing ? "edit-projectName" : "projectName"} name="projectName" required defaultValue={value.projectName} /><FieldError errors={errors} name="projectName" /></div><div><label className="field-label" htmlFor={editing ? "edit-leadId" : "leadId"}>Lead vinculado</label><select className="field" id={editing ? "edit-leadId" : "leadId"} name="leadId" defaultValue={value.leadId ?? ""}><option value="">Não vincular agora</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.companyName}</option>)}</select></div><div><label className="field-label" htmlFor={editing ? "edit-totalAmount" : "totalAmount"}>Valor contratado (R$) *</label><input className="field" id={editing ? "edit-totalAmount" : "totalAmount"} name="totalAmount" inputMode="decimal" placeholder="1290,00" defaultValue={displayAmount(value.totalAmountCents)} required /><FieldError errors={errors} name="totalAmount" /><FieldError errors={errors} name="totalAmountCents" /></div><div><label className="field-label" htmlFor={editing ? "edit-projectStatus" : "projectStatus"}>Status</label><select className="field" id={editing ? "edit-projectStatus" : "projectStatus"} name="status" defaultValue={value.status}>{projectStatuses.map((status) => <option key={status} value={status}>{projectStatusLabels[status]}</option>)}</select></div><div><label className="field-label" htmlFor={editing ? "edit-startDate" : "startDate"}>Início</label><input className="field" id={editing ? "edit-startDate" : "startDate"} name="startDate" type="date" defaultValue={toDateInputValue(value.startDate)} /></div><div><label className="field-label" htmlFor={editing ? "edit-completionDate" : "completionDate"}>Conclusão</label><input className="field" id={editing ? "edit-completionDate" : "completionDate"} name="completionDate" type="date" defaultValue={toDateInputValue(value.completionDate)} /></div><div className="sm:col-span-2"><label className="field-label" htmlFor={editing ? "edit-projectNotes" : "projectNotes"}>Observações</label><textarea className="textarea" id={editing ? "edit-projectNotes" : "projectNotes"} name="notes" defaultValue={value.notes ?? ""} /></div></div><div className="flex justify-end"><button className="button-primary" disabled={saving}>{saving ? "Salvando…" : editing ? "Salvar projeto" : "Criar projeto"}</button></div></form>;
}
