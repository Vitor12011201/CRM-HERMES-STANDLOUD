"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AssistantChatProps = {
  compact?: boolean;
  onClose?: () => void;
};

const maxStoredMessages = 12;

function getLeadId(pathname: string) {
  const match = pathname.match(/^\/leads\/([^/]+)$/);
  return match?.[1];
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content };
}

function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/```(?:[\w-]+)?\n?|```/u);

  return (
    <div className="space-y-2 text-sm leading-6">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="overflow-x-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100"><code>{block}</code></pre>
        ) : block ? (
          <p key={index} className="whitespace-pre-wrap break-words">{block}</p>
        ) : null,
      )}
    </div>
  );
}

export function AssistantChat({ compact = false, onClose }: AssistantChatProps) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(
    () => ({ currentRoute: pathname, ...(getLeadId(pathname) ? { currentLeadId: getLeadId(pathname) } : {}) }),
    [pathname],
  );

  useEffect(() => {
    let active = true;

    async function checkStatus() {
      try {
        const response = await fetch("/api/assistant/status", { cache: "no-store" });
        const body = (await response.json()) as { online?: boolean };
        if (active) setOnline(response.ok && body.online === true);
      } catch {
        if (active) setOnline(false);
      }
    }

    void checkStatus();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage || loading) return;

    const userMessage = createMessage("user", trimmedMessage);
    setMessages((current) => [...current, userMessage].slice(-maxStoredMessages));
    setMessage("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmedMessage, context }),
      });
      const body = (await response.json()) as { message?: string; error?: string };

      if (!response.ok || !body.message) {
        setOnline(false);
        setError(body.error ?? "Hermes está offline ou indisponível no momento.");
        return;
      }

      setOnline(true);
      setMessages((current) => [...current, createMessage("assistant", body.message)].slice(-maxStoredMessages));
    } catch {
      setOnline(false);
      setError("Hermes está offline ou indisponível no momento.");
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setError(null);
  }

  return (
    <section className={compact ? "flex h-full flex-col bg-white" : "panel flex min-h-[560px] flex-col overflow-hidden"} aria-label="Conversa com Hermes">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-ink">Hermes</h1>
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${online ? "text-emerald-700" : "text-slate-500"}`} aria-live="polite">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
              {online ? "Online" : online === false ? "Offline" : "Verificando"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">Assistente do CRM. Consulta dados e realiza alterações controladas quando solicitado.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={clearConversation} className="button-secondary min-h-8 px-2 py-1 text-xs">Limpar</button>
          {onClose ? <button type="button" onClick={onClose} className="button-secondary min-h-8 px-2 py-1 text-xs" aria-label="Fechar conversa">Fechar</button> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4" aria-live="polite">
        {messages.length === 0 ? <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-muted">Pergunte sobre leads, pipeline, follow-ups ou resumo financeiro. Você também pode solicitar nota, status ou follow-up de um lead.</p> : null}
        {messages.map((item) => (
          <div key={item.id} className={`max-w-[90%] rounded-lg px-3 py-2 ${item.role === "user" ? "ml-auto bg-brand text-white" : "border border-line bg-white text-ink"}`}>
            <p className={`mb-1 text-xs font-semibold ${item.role === "user" ? "text-emerald-50" : "text-muted"}`}>{item.role === "user" ? "Você" : "Hermes"}</p>
            <MessageContent content={item.content} />
          </div>
        ))}
        {loading ? <div className="max-w-[90%] rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted">Hermes está processando sua solicitação…</div> : null}
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-line bg-white p-3">
        <label htmlFor={compact ? "hermes-drawer-message" : "hermes-page-message"} className="sr-only">Mensagem para Hermes</label>
        <textarea
          id={compact ? "hermes-drawer-message" : "hermes-page-message"}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={4_000}
          rows={3}
          className="textarea min-h-20"
          placeholder="Ex.: Quais follow-ups estão atrasados?"
          disabled={loading}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Contexto: {pathname}</p>
          <button type="submit" className="button-primary" disabled={loading || !message.trim()}>{loading ? "Consultando…" : "Enviar"}</button>
        </div>
      </form>
    </section>
  );
}
