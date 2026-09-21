"use client";

import { useState } from "react";

import { AssistantChat } from "@/components/AssistantChat";

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#1c3028] focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        aria-label="Abrir conversa com Hermes"
      >
        Hermes
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 bg-slate-950/30" role="dialog" aria-modal="true" aria-label="Conversa com Hermes">
          <div className="absolute inset-x-0 bottom-0 h-[min(80vh,680px)] rounded-t-xl shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[430px] sm:rounded-none">
            <AssistantChat compact onClose={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
