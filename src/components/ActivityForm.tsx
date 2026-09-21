"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { activityChannelLabels, activityChannels, activityTypeLabels, activityTypes } from "@/lib/constants";
import { FieldError, FormMessage } from "./FormMessage";

export function ActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter(); const [errors, setErrors] = useState<Record<string, string[] | undefined>>({}); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setSaving(true); setErrors({}); setMessage("");
    const response = await fetch(`/api/leads/${leadId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setMessage(result.error ?? "Não foi possível registrar a atividade."); setErrors(result.fields ?? {}); return; }
    form.reset(); router.refresh();
  }
  return <form onSubmit={submit} noValidate className="space-y-3">
    <FormMessage message={message} />
    <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="activityType" className="field-label">Tipo *</label><select className="field" id="activityType" name="type" defaultValue="NOTE">{activityTypes.map((type) => <option key={type} value={type}>{activityTypeLabels[type]}</option>)}</select></div><div><label htmlFor="activityChannel" className="field-label">Canal</label><select className="field" id="activityChannel" name="channel" defaultValue=""><option value="">Não informado</option>{activityChannels.map((channel) => <option key={channel} value={channel}>{activityChannelLabels[channel]}</option>)}</select></div></div>
    <div><label htmlFor="activityNote" className="field-label">Registro *</label><textarea id="activityNote" name="note" className="textarea" placeholder="O que aconteceu?" required /><FieldError errors={errors} name="note" /></div>
    <div className="flex justify-end"><button className="button-primary" disabled={saving}>{saving ? "Registrando…" : "Adicionar atividade"}</button></div>
  </form>;
}
