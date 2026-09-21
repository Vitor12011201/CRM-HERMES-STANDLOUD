"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadStatus } from "@/generated/prisma/enums";
import { FieldError, FormMessage } from "./FormMessage";
import { leadStatusLabels, leadStatuses } from "@/lib/lead";
import { toDateInputValue } from "@/lib/format";

export type LeadFormData = {
  id?: string;
  companyName: string; city?: string | null; region?: string | null; segment?: string | null;
  websiteUrl?: string | null; googleMapsUrl?: string | null; instagramUrl?: string | null;
  whatsapp?: string | null; phone?: string | null; email?: string | null; source?: string | null;
  primaryService?: string | null; googleRating?: number | null; googleReviewCount?: number | null;
  mainProblem?: string | null; qualificationScore: number; status: LeadStatus; notes?: string | null;
  demoUrl?: string | null; videoUrl?: string | null; proposalUrl?: string | null;
  lastContactAt?: Date | string | null; nextFollowUpAt?: Date | string | null;
};

const text = (value?: string | null) => value ?? "";

export function LeadForm({ initial, compact = false, onSaved }: { initial?: LeadFormData; compact?: boolean; onSaved?: () => void }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(initial?.id);
  const value = initial ?? { companyName: "", qualificationScore: 0, status: "NEW" as LeadStatus };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true); setMessage(""); setErrors({});
    const response = await fetch(isEditing ? `/api/leads/${initial?.id}` : "/api/leads", {
      method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setMessage(result.error ?? "Não foi possível salvar o lead."); setErrors(result.fields ?? {}); return; }
    if (!isEditing) { router.push(`/leads/${result.lead.id}`); return; }
    setMessage("Lead atualizado."); router.refresh(); onSaved?.();
  }

  const inputClass = "field";
  return (
    <form onSubmit={submit} className={compact ? "space-y-4" : "space-y-6"} noValidate>
      <FormMessage message={message} />
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Empresa</legend>
        <div className="sm:col-span-2 lg:col-span-3"><label className="field-label" htmlFor="companyName">Empresa *</label><input className={inputClass} id="companyName" name="companyName" defaultValue={value.companyName} required /><FieldError errors={errors} name="companyName" /></div>
        <div><label className="field-label" htmlFor="city">Cidade</label><input className={inputClass} id="city" name="city" defaultValue={text(value.city)} /></div>
        <div><label className="field-label" htmlFor="region">Estado / região</label><input className={inputClass} id="region" name="region" defaultValue={text(value.region)} /></div>
        <div><label className="field-label" htmlFor="segment">Segmento</label><input className={inputClass} id="segment" name="segment" defaultValue={text(value.segment)} /></div>
        <div><label className="field-label" htmlFor="primaryService">Serviço principal</label><input className={inputClass} id="primaryService" name="primaryService" defaultValue={text(value.primaryService)} /></div>
        <div><label className="field-label" htmlFor="source">Origem</label><input className={inputClass} id="source" name="source" placeholder="Ex.: indicação, pesquisa" defaultValue={text(value.source)} /></div>
      </fieldset>

      {!compact && <>
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-3 text-sm font-semibold text-ink sm:col-span-2 lg:col-span-3">Contato e links</legend>
          <div><label className="field-label" htmlFor="websiteUrl">Site</label><input className={inputClass} id="websiteUrl" name="websiteUrl" type="url" placeholder="https://" defaultValue={text(value.websiteUrl)} /><FieldError errors={errors} name="websiteUrl" /></div>
          <div><label className="field-label" htmlFor="googleMapsUrl">Google Maps</label><input className={inputClass} id="googleMapsUrl" name="googleMapsUrl" type="url" placeholder="https://" defaultValue={text(value.googleMapsUrl)} /><FieldError errors={errors} name="googleMapsUrl" /></div>
          <div><label className="field-label" htmlFor="instagramUrl">Instagram</label><input className={inputClass} id="instagramUrl" name="instagramUrl" type="url" placeholder="https://" defaultValue={text(value.instagramUrl)} /><FieldError errors={errors} name="instagramUrl" /></div>
          <div><label className="field-label" htmlFor="whatsapp">WhatsApp</label><input className={inputClass} id="whatsapp" name="whatsapp" defaultValue={text(value.whatsapp)} /></div>
          <div><label className="field-label" htmlFor="phone">Telefone</label><input className={inputClass} id="phone" name="phone" defaultValue={text(value.phone)} /></div>
          <div><label className="field-label" htmlFor="email">E-mail</label><input className={inputClass} id="email" name="email" type="email" defaultValue={text(value.email)} /><FieldError errors={errors} name="email" /></div>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-3 text-sm font-semibold text-ink sm:col-span-2 lg:col-span-3">Qualificação e comercial</legend>
          <div><label className="field-label" htmlFor="qualificationScore">Pontuação (0 a 10) *</label><input className={inputClass} id="qualificationScore" name="qualificationScore" type="number" min="0" max="10" step="1" defaultValue={value.qualificationScore} required /><FieldError errors={errors} name="qualificationScore" /></div>
          <div><label className="field-label" htmlFor="googleRating">Avaliação no Google</label><input className={inputClass} id="googleRating" name="googleRating" type="number" min="0" max="5" step="0.1" defaultValue={value.googleRating ?? ""} /><FieldError errors={errors} name="googleRating" /></div>
          <div><label className="field-label" htmlFor="googleReviewCount">Nº de avaliações</label><input className={inputClass} id="googleReviewCount" name="googleReviewCount" type="number" min="0" step="1" defaultValue={value.googleReviewCount ?? ""} /><FieldError errors={errors} name="googleReviewCount" /></div>
          <div><label className="field-label" htmlFor="status">Status</label><select className={inputClass} id="status" name="status" defaultValue={value.status}>{leadStatuses.map((status) => <option key={status} value={status}>{leadStatusLabels[status]}</option>)}</select></div>
          <div><label className="field-label" htmlFor="lastContactAt">Último contato</label><input className={inputClass} id="lastContactAt" name="lastContactAt" type="date" defaultValue={toDateInputValue(value.lastContactAt)} /></div>
          <div><label className="field-label" htmlFor="nextFollowUpAt">Próximo follow-up</label><input className={inputClass} id="nextFollowUpAt" name="nextFollowUpAt" type="date" defaultValue={toDateInputValue(value.nextFollowUpAt)} /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="field-label" htmlFor="mainProblem">Principal problema / oportunidade</label><textarea className="textarea" id="mainProblem" name="mainProblem" defaultValue={text(value.mainProblem)} /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="field-label" htmlFor="notes">Observações</label><textarea className="textarea" id="notes" name="notes" defaultValue={text(value.notes)} /></div>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-sm font-semibold text-ink sm:col-span-3">Material comercial</legend>
          <div><label className="field-label" htmlFor="demoUrl">URL da demo</label><input className={inputClass} id="demoUrl" name="demoUrl" type="url" placeholder="https://" defaultValue={text(value.demoUrl)} /><FieldError errors={errors} name="demoUrl" /></div>
          <div><label className="field-label" htmlFor="videoUrl">URL do vídeo</label><input className={inputClass} id="videoUrl" name="videoUrl" type="url" placeholder="https://" defaultValue={text(value.videoUrl)} /><FieldError errors={errors} name="videoUrl" /></div>
          <div><label className="field-label" htmlFor="proposalUrl">URL da proposta</label><input className={inputClass} id="proposalUrl" name="proposalUrl" type="url" placeholder="https://" defaultValue={text(value.proposalUrl)} /><FieldError errors={errors} name="proposalUrl" /></div>
        </fieldset>
      </>}
      <div className="flex justify-end gap-2 border-t border-line pt-4"><button className="button-primary" disabled={saving}>{saving ? "Salvando…" : isEditing ? "Salvar alterações" : "Criar lead"}</button></div>
    </form>
  );
}
