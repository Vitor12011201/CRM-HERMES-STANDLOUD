"use client";

import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./ConfirmDialog";

export function DeleteLeadButton({ leadId, companyName }: { leadId: string; companyName: string }) {
  const router = useRouter();
  return <ConfirmDialog triggerLabel="Excluir lead" title="Excluir lead?" description={`A empresa ${companyName} e todo o histórico de atividades associado serão removidos.`} confirmLabel="Excluir lead" onConfirm={async () => { const response = await fetch(`/api/leads/${leadId}`, { method: "DELETE" }); if (!response.ok) throw new Error("Não foi possível excluir o lead."); router.push("/leads"); router.refresh(); }} />;
}
