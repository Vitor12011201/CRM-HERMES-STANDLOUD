"use client";

import { useState } from "react";
import { LeadForm } from "./LeadForm";

export function NewLeadPanel() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="button-primary" onClick={() => setOpen(true)}>Novo lead</button>
    {open && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/35 p-4 sm:p-8" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="new-lead-title" className="mx-auto my-2 max-w-4xl rounded-xl bg-white p-5 shadow-xl sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 id="new-lead-title" className="text-xl font-semibold">Novo lead</h2><p className="mt-1 text-sm text-muted">Comece pelo essencial. Os dados de contato podem ser incluídos depois.</p></div><button className="button-secondary" onClick={() => setOpen(false)} aria-label="Fechar formulário">Fechar</button></div><LeadForm /></section></div>}
  </>;
}
