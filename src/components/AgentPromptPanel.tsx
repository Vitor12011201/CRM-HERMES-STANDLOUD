"use client";

import { useState } from "react";

import type { AgentPromptConfigurationDto } from "@/lib/agent-prompt-config";

type ViewTarget = "built-in" | number;

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AgentPromptPanel({ initialConfiguration }: { initialConfiguration: AgentPromptConfigurationDto }) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [draft, setDraft] = useState(initialConfiguration.active.content);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget>(initialConfiguration.active.activeVersion ?? "built-in");

  const activeVersion = configuration.active.activeVersion;
  const viewedContent = viewTarget === "built-in"
    ? configuration.builtInContent
    : configuration.versions.find((version) => version.version === viewTarget)?.content;

  async function requestConfiguration(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as AgentPromptConfigurationDto | { error?: string } | null;
      if (!response.ok || !payload || "error" in payload) {
        setError(payload && "error" in payload && typeof payload.error === "string" ? payload.error : "AGENT_PROMPT_CONFIGURATION_UNAVAILABLE");
        return;
      }

      setConfiguration(payload);
      setDraft(payload.active.content);
      setViewTarget(payload.active.activeVersion ?? "built-in");
      setEditing(false);
      setConfirmed(false);
    } catch {
      setError("AGENT_PROMPT_CONFIGURATION_UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setDraft(configuration.active.content);
    setEditing(true);
    setConfirmed(false);
    setError(null);
  }

  function cancelEditing() {
    setDraft(configuration.active.content);
    setEditing(false);
    setConfirmed(false);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <section className="panel-pad max-w-5xl">
        <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="section-title">Instruções operacionais atuais</h2>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${configuration.active.source === "BUILT_IN" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                {configuration.active.source === "BUILT_IN" ? "Built-in" : `Configurada · v${configuration.active.activeVersion}`}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">{configuration.active.source === "BUILT_IN" ? "Prompt padrão usado como fallback enquanto não há uma versão ativa no CRM." : "Versão ativa armazenada no CRM/D1."}</p>
          </div>
          {!editing && <button type="button" className="button-secondary" onClick={startEditing}>Editar</button>}
        </div>

        {editing ? (
          <div className="mt-5">
            <label className="field-label" htmlFor="agent-prompt-content">Prompt da Ana</label>
            <textarea
              id="agent-prompt-content"
              className="textarea min-h-[28rem] font-mono text-xs leading-6"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
            />
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} className="mt-0.5" />
              <span>Esta alteração modifica as instruções operacionais da Ana.</span>
            </label>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className="button-secondary" onClick={cancelEditing} disabled={busy}>Cancelar</button>
              <button
                type="button"
                className="button-primary"
                disabled={!confirmed || draft.trim().length === 0 || busy}
                onClick={() => requestConfiguration("/api/team/researcher/prompt/versions", {
                  content: draft,
                  expectedActiveVersion: activeVersion,
                })}
              >
                {busy ? "Salvando..." : "Salvar nova versão"}
              </button>
            </div>
          </div>
        ) : (
          <pre className="mt-5 max-h-[34rem] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap">{configuration.active.content}</pre>
        )}

        {error && <p className="mt-4 text-sm font-medium text-red-700" role="alert">Não foi possível atualizar o prompt: {error}</p>}
      </section>

      <section className="panel-pad max-w-5xl">
        <div className="flex flex-col gap-2 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="section-title">Histórico de versões</h2>
            <p className="mt-1 text-sm text-muted">As versões são imutáveis. Ativar uma versão anterior funciona como rollback.</p>
          </div>
          {configuration.active.source === "CONFIGURED" && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => requestConfiguration("/api/team/researcher/prompt/default", { expectedActiveVersion: activeVersion })}
            >
              Usar prompt padrão
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <article className={`rounded-lg border p-3 ${viewTarget === "built-in" ? "border-brand bg-emerald-50/50" : "border-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Default <span className="font-normal text-muted">· Built-in / fallback</span></p>
                <p className="mt-1 text-xs text-muted">Não representa uma row no D1.</p>
              </div>
              <button type="button" className="button-secondary" onClick={() => setViewTarget("built-in")}>Ver</button>
            </div>
          </article>

          {configuration.versions.map((version) => {
            const isActive = activeVersion === version.version;
            return (
              <article className={`rounded-lg border p-3 ${isActive ? "border-emerald-300 bg-emerald-50/50" : "border-line"}`} key={version.version}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">v{version.version} {isActive && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Ativa</span>}</p>
                    <p className="mt-1 text-xs text-muted">Criada em {formatVersionDate(version.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="button-secondary" onClick={() => setViewTarget(version.version)}>Ver</button>
                    {!isActive && <button type="button" className="button-secondary" disabled={busy} onClick={() => requestConfiguration("/api/team/researcher/prompt/activate", { version: version.version, expectedActiveVersion: activeVersion })}>Ativar</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {viewTarget !== (configuration.active.activeVersion ?? "built-in") && viewedContent && (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Versão selecionada para consulta</p>
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap">{viewedContent}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
