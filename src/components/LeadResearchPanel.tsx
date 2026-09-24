"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { getAgentProfile } from "@/lib/agents/registry";
import type { LeadResearchRunDto } from "@/lib/research-workflow";

type Props = {
  leadId: string;
  hasWebsite: boolean;
  initialRuns: LeadResearchRunDto[];
};

const statusLabel: Record<LeadResearchRunDto["status"], string> = {
  PENDING_REVIEW: "Aguardando revisão humana",
  APPROVING: "Aprovação em processamento / reconciliação",
  APPROVED: "Pesquisa concluída",
  REJECTED: "Pesquisa rejeitada",
};

const researcherProfile = getAgentProfile("researcher");
if (!researcherProfile) throw new Error("researcher organizational profile is required");

function promptLabel(run: LeadResearchRunDto) {
  return run.promptSource === "BUILT_IN" ? "Built-in" : `v${run.promptVersion} configurada`;
}

export function LeadResearchPanel({ leadId, hasWebsite, initialRuns }: Props) {
  const [runs, setRuns] = useState(initialRuns);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(url: string, body: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { run?: LeadResearchRunDto; error?: string } | null;
    if (!response.ok || !payload?.run) throw new Error(payload?.error ?? "RESEARCH_WORKFLOW_FAILED");
    return payload.run;
  }

  function replaceRun(next: LeadResearchRunDto) {
    setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)]);
  }

  async function start() {
    setBusy("start");
    setError(null);
    try {
      replaceRun(await request(`/api/leads/${leadId}/research/runs`, {}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "RESEARCH_WORKFLOW_FAILED");
    } finally {
      setBusy(null);
    }
  }

  async function approve(run: LeadResearchRunDto) {
    setBusy(run.id);
    setError(null);
    try {
      // The server reloads the run; this body is only an explicit index selection.
      replaceRun(await request(
        `/api/leads/${leadId}/research/runs/${run.id}/approve`,
        { approvedEvidenceIndexes: run.status === "APPROVING" ? run.approvedEvidenceIndexes ?? [] : selected[run.id] ?? [] },
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "RESEARCH_WORKFLOW_FAILED");
    } finally {
      setBusy(null);
    }
  }

  async function reject(run: LeadResearchRunDto) {
    setBusy(run.id);
    setError(null);
    try {
      replaceRun(await request(`/api/leads/${leadId}/research/runs/${run.id}/reject`, {}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "RESEARCH_WORKFLOW_FAILED");
    } finally {
      setBusy(null);
    }
  }

  function toggleEvidence(runId: string, index: number) {
    setSelected((current) => {
      const indexes = current[runId] ?? [];
      return { ...current, [runId]: indexes.includes(index) ? indexes.filter((value) => value !== index) : [...indexes, index] };
    });
  }

  return (
    <section className="panel-pad">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image alt={researcherProfile.displayName} className="h-10 w-10 rounded-full border border-line object-cover" height={40} src={researcherProfile.avatar} width={40} />
          <div><h2 className="section-title">Pesquisa com Ana</h2><p className="mt-1 text-sm text-muted">Ana observa fontes públicas; ela não qualifica nem recomenda ações.</p></div>
        </div>
        <Link className="text-sm font-medium text-brand hover:underline" href={`/team/${researcherProfile.technicalId}`}>Perfil de {researcherProfile.displayName}</Link>
      </div>

      {!hasWebsite ? <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Ana precisa de um website público para executar a Research V1.</p> : (
        <button className="button-secondary mt-5" disabled={busy !== null} onClick={start} type="button">{busy === "start" ? "Pesquisando…" : "Pesquisar com Ana"}</button>
      )}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}

      {runs.length > 0 && <ol className="mt-6 space-y-5 border-t border-line pt-5">
        {runs.map((run) => <li className="rounded-lg border border-line p-4" key={run.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-ink">Pesquisa realizada por {researcherProfile.displayName}</p><span className="text-sm text-muted">{statusLabel[run.status]}</span></div>
          <dl className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-3"><div><dt>Fonte consultada</dt><dd className="font-medium text-ink">Website</dd></div><div><dt>Prompt</dt><dd className="font-medium text-ink">{promptLabel(run)}</dd></div><div><dt>Modelo</dt><dd className="font-medium text-ink">{run.model}</dd></div></dl>
          <p className="mt-4 text-sm text-muted">Confiança da pesquisa: <strong className="text-ink">{run.result.confidence}</strong>. Mede a suficiência da pesquisa, não a qualidade comercial do Lead.</p>
          {run.result.evidence.length > 0 && <div className="mt-4 space-y-3"><h3 className="text-sm font-semibold text-ink">Evidências candidatas</h3>{run.result.evidence.map((evidence, index) => <label className="flex gap-3 rounded-lg bg-slate-50 p-3 text-sm" key={index}><input checked={(selected[run.id] ?? []).includes(index)} disabled={run.status !== "PENDING_REVIEW" || busy !== null} onChange={() => toggleEvidence(run.id, index)} type="checkbox" /><span><span className="font-medium">{evidence.sourceType}</span><br />{evidence.observation}{evidence.sourceUrl && <> <a className="text-brand hover:underline" href={evidence.sourceUrl} rel="noreferrer" target="_blank">Fonte ↗</a></>}</span></label>)}</div>}
          {run.result.unresolvedQuestions.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold text-ink">Questões não confirmadas</h3><ul className="mt-2 space-y-1 text-sm text-muted">{run.result.unresolvedQuestions.map((question) => <li key={question}>• {question}</li>)}</ul></div>}
          {run.status === "PENDING_REVIEW" && <div className="mt-5 flex flex-wrap gap-3"><button className="button-primary" disabled={busy !== null} onClick={() => approve(run)} type="button">Aprovar evidências selecionadas</button><button className="button-secondary" disabled={busy !== null} onClick={() => reject(run)} type="button">Rejeitar pesquisa</button></div>}
          {run.status === "APPROVING" && <button className="button-secondary mt-5" disabled={busy !== null} onClick={() => approve(run)} type="button">Verificar aprovação</button>}
        </li>)}
      </ol>}
    </section>
  );
}
