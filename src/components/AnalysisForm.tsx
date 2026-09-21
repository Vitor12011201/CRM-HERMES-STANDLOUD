"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisConfidence } from "@/generated/prisma/enums";
import { analysisConfidenceLabels, analysisConfidences } from "@/lib/constants";
import { FieldError, FormMessage } from "./FormMessage";

export type LeadAnalysisFormData = {
  summary?: string | null;
  opportunity?: string | null;
  commercialSignals?: string | null;
  demoConcept?: string | null;
  confidence?: AnalysisConfidence;
};

export function AnalysisForm({ leadId, initial }: { leadId: string; initial?: LeadAnalysisFormData | null }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage("");
    const response = await fetch(`/api/leads/${leadId}/analysis`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessageKind("error");
      setMessage(result.error ?? "Não foi possível salvar a análise.");
      setErrors(result.fields ?? {});
      return;
    }
    setMessageKind("success");
    setMessage("Análise salva.");
    router.refresh();
  }

  return <form onSubmit={submit} noValidate className="space-y-3">
    <FormMessage message={message} kind={messageKind} />
    <div><label className="field-label" htmlFor="analysisSummary">Resumo</label><textarea className="textarea" id="analysisSummary" name="summary" defaultValue={initial?.summary ?? ""} placeholder="Leitura geral da oportunidade com base nas evidências." /><FieldError errors={errors} name="summary" /></div>
    <div><label className="field-label" htmlFor="analysisOpportunity">Oportunidade</label><textarea className="textarea" id="analysisOpportunity" name="opportunity" defaultValue={initial?.opportunity ?? ""} placeholder="O que poderia ser melhorado ou explorado digitalmente." /><FieldError errors={errors} name="opportunity" /></div>
    <div><label className="field-label" htmlFor="analysisSignals">Sinais comerciais</label><textarea className="textarea" id="analysisSignals" name="commercialSignals" defaultValue={initial?.commercialSignals ?? ""} placeholder="Sinais que tornam a empresa mais ou menos interessante para prospecção." /><FieldError errors={errors} name="commercialSignals" /></div>
    <div><label className="field-label" htmlFor="analysisDemoConcept">Conceito de demo</label><textarea className="textarea" id="analysisDemoConcept" name="demoConcept" defaultValue={initial?.demoConcept ?? ""} placeholder="Direção que uma demo personalizada poderia explorar." /><FieldError errors={errors} name="demoConcept" /></div>
    <div className="max-w-xs"><label className="field-label" htmlFor="analysisConfidence">Confiança *</label><select className="field" id="analysisConfidence" name="confidence" defaultValue={initial?.confidence ?? "MEDIUM"}>{analysisConfidences.map((confidence) => <option key={confidence} value={confidence}>{analysisConfidenceLabels[confidence]}</option>)}</select><FieldError errors={errors} name="confidence" /></div>
    <div className="flex justify-end"><button className="button-primary" disabled={saving}>{saving ? "Salvando…" : "Salvar análise"}</button></div>
  </form>;
}
