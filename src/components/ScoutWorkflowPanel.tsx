"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { requiresInitialScoutApprovalAcknowledgement } from "@/lib/scout-workflow-ui";

type ReviewCard = {
  id: string;
  companyName: string;
  city?: string;
  region?: string;
  segment?: string;
  websiteUrl?: string;
  source: { type: string };
  basis: string[];
  unresolvedQuestions: string[];
  status: "PENDING" | "APPROVING";
};

type Operation = "discover" | "approve" | "reject" | null;

function location(review: ReviewCard) {
  return [review.city, review.region].filter(Boolean).join(" · ") || "Localização não informada";
}

function safeMessage(value: unknown, fallback: string) {
  if (typeof value !== "object" || value === null || !("error" in value)) return fallback;
  return typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : fallback;
}

async function jsonRequest(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => ({})) as unknown };
}

/** Browser controls submit only discovery constraints, IDs, and human acknowledgement. */
export function ScoutWorkflowPanel({ reviews }: { reviews: ReviewCard[] }) {
  const router = useRouter();
  const [city, setCity] = useState("Jacarei");
  const [region, setRegion] = useState("SP");
  const [segment, setSegment] = useState("Contabilidade");
  const [requirePublicWebsite, setRequirePublicWebsite] = useState(true);
  const [limit, setLimit] = useState(20);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [operation, setOperation] = useState<Operation>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOperation("discover");
    setMessage("");
    const { response, body } = await jsonRequest("/api/scout/discover", {
      city,
      region,
      segment,
      requirePublicWebsite,
      limit,
    });
    setOperation(null);
    if (!response.ok) {
      setMessage(safeMessage(body, "Não foi possível executar a descoberta."));
      return;
    }
    if ((body as { outcome?: unknown }).outcome === "NONE") {
      setMessage("Nenhum novo candidato elegível foi encontrado para estes critérios.");
      return;
    }
    setMessage("Candidato salvo para revisão humana.");
    router.refresh();
  }

  async function reject(review: ReviewCard) {
    setOperation("reject");
    setActiveReviewId(review.id);
    setMessage("");
    const { response, body } = await jsonRequest(`/api/scout/reviews/${review.id}/reject`, {});
    setOperation(null);
    setActiveReviewId(null);
    if (!response.ok) {
      setMessage(safeMessage(body, "Não foi possível rejeitar o candidato."));
      return;
    }
    setMessage("Candidato rejeitado.");
    router.refresh();
  }

  async function approve(review: ReviewCard) {
    const requiresAcknowledgement = requiresInitialScoutApprovalAcknowledgement(review);
    if (requiresAcknowledgement && acknowledged[review.id] !== true) return;
    setOperation("approve");
    setActiveReviewId(review.id);
    setMessage("");
    const { response, body } = await jsonRequest(`/api/scout/reviews/${review.id}/approve`, {
      ...(requiresAcknowledgement && acknowledged[review.id] === true
        ? { acknowledgeUnresolvedQuestions: true }
        : {}),
    });
    setOperation(null);
    setActiveReviewId(null);
    if (!response.ok) {
      setMessage(safeMessage(body, "A aprovação requer reconciliação antes de continuar."));
      return;
    }
    const leadId = (body as { leadId?: unknown }).leadId;
    if (typeof leadId === "string") {
      router.push(`/leads/${leadId}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form className="panel-pad grid gap-4 md:grid-cols-2 lg:grid-cols-5" onSubmit={discover} noValidate>
        <div><label className="field-label" htmlFor="scout-city">Cidade</label><input className="field" id="scout-city" value={city} onChange={(event) => setCity(event.target.value)} required /></div>
        <div><label className="field-label" htmlFor="scout-region">Estado / região</label><input className="field" id="scout-region" value={region} onChange={(event) => setRegion(event.target.value)} /></div>
        <div><label className="field-label" htmlFor="scout-segment">Segmento</label><input className="field" id="scout-segment" value={segment} onChange={(event) => setSegment(event.target.value)} required /></div>
        <div><label className="field-label" htmlFor="scout-limit">Limite</label><input className="field" id="scout-limit" type="number" min="1" max="50" value={limit} onChange={(event) => setLimit(Number(event.target.value))} required /></div>
        <div className="flex items-end"><button className="button-primary w-full" disabled={operation !== null}>{operation === "discover" ? "Buscando…" : "Buscar candidato"}</button></div>
        <label className="flex items-center gap-2 text-sm text-ink md:col-span-2 lg:col-span-5"><input type="checkbox" checked={requirePublicWebsite} onChange={(event) => setRequirePublicWebsite(event.target.checked)} /> Exigir website público</label>
      </form>

      {message ? <p role="status" className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">{message}</p> : null}

      <section aria-label="Candidatos Scout para revisão" className="space-y-4">
        {reviews.length === 0 ? <div className="panel-pad text-sm text-muted">Nenhum candidato aguardando revisão.</div> : reviews.map((review) => {
          const isApproving = review.status === "APPROVING";
          const busy = activeReviewId === review.id && operation !== null;
          const hasUnresolvedQuestions = review.unresolvedQuestions.length > 0;
          const requiresAcknowledgement = requiresInitialScoutApprovalAcknowledgement(review);
          return <article className="panel-pad" key={review.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-ink">{review.companyName}</p>
                <p className="mt-1 text-sm text-muted">{location(review)} · {review.segment ?? "Segmento não informado"}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">Fonte: {review.source.type}</p>
              </div>
              {review.websiteUrl ? <a className="text-sm font-medium text-brand hover:underline" href={review.websiteUrl} target="_blank" rel="noreferrer">Abrir website</a> : null}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div><h2 className="text-sm font-semibold text-ink">Base determinística</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{review.basis.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h2 className="text-sm font-semibold text-ink">Questões em aberto</h2>{hasUnresolvedQuestions ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{review.unresolvedQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted">Nenhuma.</p>}</div>
            </div>
            {requiresAcknowledgement ? <label className="mt-4 flex items-start gap-2 text-sm text-ink"><input className="mt-1" type="checkbox" checked={acknowledged[review.id] === true} onChange={(event) => setAcknowledged((current) => ({ ...current, [review.id]: event.target.checked }))} /> Confirmo que revisei as questões em aberto antes de criar um Lead.</label> : null}
            {isApproving ? <div className="mt-5 flex flex-wrap items-center gap-3"><p className="text-sm text-amber-800">Aprovação em processamento ou reconciliação.</p><button className="button-secondary" type="button" disabled={busy} onClick={() => approve(review)}>{busy ? "Verificando…" : "Verificar aprovação"}</button></div> : <div className="mt-5 flex flex-wrap gap-2"><button className="button-secondary" type="button" disabled={busy} onClick={() => reject(review)}>{busy && operation === "reject" ? "Rejeitando…" : "Rejeitar"}</button><button className="button-primary" type="button" disabled={busy || (requiresAcknowledgement && acknowledged[review.id] !== true)} onClick={() => approve(review)}>{busy && operation === "approve" ? "Aprovando…" : "Aprovar e criar Lead"}</button></div>}
          </article>;
        })}
      </section>
    </div>
  );
}
