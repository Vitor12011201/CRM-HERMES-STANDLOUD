"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { evidenceSourceTypeLabels, evidenceSourceTypes } from "@/lib/constants";
import { FieldError, FormMessage } from "./FormMessage";

export function EvidenceForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setErrors({});
    setMessage("");
    const response = await fetch(`/api/leads/${leadId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessage(result.error ?? "Não foi possível registrar a evidência.");
      setErrors(result.fields ?? {});
      return;
    }
    form.reset();
    router.refresh();
  }

  return <form onSubmit={submit} noValidate className="space-y-3">
    <FormMessage message={message} />
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className="field-label" htmlFor="evidenceSourceType">Fonte *</label><select className="field" id="evidenceSourceType" name="sourceType" defaultValue="WEBSITE">{evidenceSourceTypes.map((sourceType) => <option key={sourceType} value={sourceType}>{evidenceSourceTypeLabels[sourceType]}</option>)}</select><FieldError errors={errors} name="sourceType" /></div>
      <div><label className="field-label" htmlFor="evidenceSourceUrl">URL da fonte</label><input className="field" id="evidenceSourceUrl" name="sourceUrl" type="url" inputMode="url" placeholder="https://" /><FieldError errors={errors} name="sourceUrl" /></div>
    </div>
    <div><label className="field-label" htmlFor="evidenceObservation">Observação factual *</label><textarea className="textarea" id="evidenceObservation" name="observation" required placeholder="Ex.: O site não possui CTA visível antes da primeira dobra." /><FieldError errors={errors} name="observation" /></div>
    <div className="flex justify-end"><button className="button-primary" disabled={saving}>{saving ? "Registrando…" : "Adicionar evidência"}</button></div>
  </form>;
}
