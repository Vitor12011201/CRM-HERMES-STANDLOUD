"use client";

import { useState } from "react";

export function ConfirmDialog({ triggerLabel, title, description, confirmLabel, onConfirm }: { triggerLabel: string; title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [working, setWorking] = useState(false);
  async function confirm() { setWorking(true); await onConfirm(); setWorking(false); setOpen(false); }
  return <><button type="button" className="button-secondary text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}>{triggerLabel}</button>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"><h2 id="confirm-title" className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-muted">{description}</p><div className="mt-5 flex justify-end gap-2"><button className="button-secondary" onClick={() => setOpen(false)} disabled={working}>Cancelar</button><button className="button-danger" onClick={confirm} disabled={working}>{working ? "Excluindo…" : confirmLabel}</button></div></section></div>}</>;
}
