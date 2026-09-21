"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldError, FormMessage } from "./FormMessage";
import { moneyToCents } from "./ProjectForm";
import { getBusinessCalendarDateKey } from "@/lib/business-time";

export function PaymentForm({ projectId, outstandingCents }: { projectId: string; outstandingCents: number }) {
  const router = useRouter(); const [errors, setErrors] = useState<Record<string, string[] | undefined>>({}); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const cents = moneyToCents(String(data.amount)); if (!cents) { setErrors({ amount: ["Informe um valor positivo."] }); return; } delete data.amount; setSaving(true); setErrors({}); setMessage(""); const response = await fetch(`/api/projects/${projectId}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, amountCents: cents }) }); const result = await response.json().catch(() => ({})); setSaving(false); if (!response.ok) { setMessage(result.error ?? "Não foi possível registrar o pagamento."); setErrors(result.fields ?? {}); return; } form.reset(); router.refresh(); }
  if (outstandingCents === 0) return <p className="text-sm text-emerald-700">Projeto integralmente recebido.</p>;
  return <form onSubmit={submit} noValidate className="space-y-3"><FormMessage message={message} /><div className="grid gap-3 sm:grid-cols-2"><div><label className="field-label" htmlFor={`payment-amount-${projectId}`}>Valor (R$) *</label><input className="field" id={`payment-amount-${projectId}`} name="amount" inputMode="decimal" placeholder="645,00" required /><FieldError errors={errors} name="amount" /><FieldError errors={errors} name="amountCents" /></div><div><label className="field-label" htmlFor={`payment-date-${projectId}`}>Data *</label><input className="field" id={`payment-date-${projectId}`} name="paidAt" type="date" defaultValue={getBusinessCalendarDateKey()} required /></div><div><label className="field-label" htmlFor={`payment-method-${projectId}`}>Forma de pagamento</label><input className="field" id={`payment-method-${projectId}`} name="paymentMethod" placeholder="Ex.: Pix, transferência" /></div><div><label className="field-label" htmlFor={`payment-notes-${projectId}`}>Observação</label><input className="field" id={`payment-notes-${projectId}`} name="notes" /></div></div><div className="flex justify-end"><button className="button-primary" disabled={saving}>{saving ? "Registrando…" : "Registrar pagamento"}</button></div></form>;
}
