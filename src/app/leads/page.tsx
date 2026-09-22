import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server";
import type { LeadStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getLeadClassification, leadStatusLabels, leadStatuses } from "@/lib/lead";
import { formatDate, isOverdueFollowUp } from "@/lib/format";
import { ClassificationBadge, StatusBadge } from "@/components/Badges";
import { PageHeader } from "@/components/PageHeader";
import { NewLeadPanel } from "@/components/NewLeadPanel";

type SearchParams = Promise<{ q?: string; status?: string; classification?: string; segment?: string; sort?: string }>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageSession();
  const query = await searchParams;
  const db = getDb();
  const q = query.q?.trim() ?? "";
  const status = leadStatuses.includes(query.status as LeadStatus) ? query.status as LeadStatus : undefined;
  const segment = query.segment?.trim() || undefined;
  const sort = ["updated", "score", "company", "followup"].includes(query.sort ?? "") ? query.sort! : "updated";
  const orderBy: Prisma.LeadOrderByWithRelationInput = sort === "score" ? { qualificationScore: "desc" } : sort === "company" ? { companyName: "asc" } : sort === "followup" ? { nextFollowUpAt: "asc" } : { updatedAt: "desc" };
  const leads = await db.lead.findMany({ where: { ...(q ? { companyName: { contains: q } } : {}), ...(status ? { status } : {}), ...(segment ? { segment } : {}) }, orderBy });
  const classification = ["A", "B", "C"].includes(query.classification ?? "") ? query.classification as "A" | "B" | "C" : undefined;
  const shownLeads = classification ? leads.filter((lead) => getLeadClassification(lead.qualificationScore) === classification) : leads;
  const segments = await db.lead.findMany({ where: { segment: { not: null } }, distinct: ["segment"], select: { segment: true }, orderBy: { segment: "asc" } });
  return <div className="page">
    <PageHeader title="Leads" description="Prospecção, qualificação e acompanhamento comercial." action={<NewLeadPanel />} />
    <form className="panel-pad mb-5 grid gap-3 md:grid-cols-2 lg:grid-cols-5" action="/leads">
      <div className="lg:col-span-2"><label htmlFor="q" className="field-label">Buscar empresa</label><input className="field" id="q" name="q" defaultValue={q} placeholder="Nome da empresa" /></div>
      <div><label htmlFor="status" className="field-label">Status</label><select className="field" name="status" id="status" defaultValue={status ?? ""}><option value="">Todos</option>{leadStatuses.map((item) => <option key={item} value={item}>{leadStatusLabels[item]}</option>)}</select></div>
      <div><label htmlFor="classification" className="field-label">Classificação</label><select className="field" name="classification" id="classification" defaultValue={classification ?? ""}><option value="">Todas</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></div>
      <div><label htmlFor="segment" className="field-label">Segmento</label><select className="field" name="segment" id="segment" defaultValue={segment ?? ""}><option value="">Todos</option>{segments.map((item) => item.segment && <option key={item.segment} value={item.segment}>{item.segment}</option>)}</select></div>
      <div><label htmlFor="sort" className="field-label">Ordenar por</label><select className="field" name="sort" id="sort" defaultValue={sort}><option value="updated">Última atualização</option><option value="score">Maior pontuação</option><option value="company">Empresa (A–Z)</option><option value="followup">Próximo follow-up</option></select></div>
      <div className="flex items-end gap-2 md:col-span-2 lg:col-span-4"><button className="button-primary">Aplicar filtros</button><Link href="/leads" className="button-secondary">Limpar</Link></div>
    </form>
    <section className="panel overflow-hidden" aria-label="Lista de leads">
      {shownLeads.length === 0 ? <div className="p-10 text-center"><p className="font-medium">Nenhum lead encontrado com esses filtros.</p><p className="mt-1 text-sm text-muted">Ajuste os filtros ou adicione seu primeiro prospect.</p></div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Empresa</th><th>Localização</th><th>Segmento</th><th>Pontuação</th><th>Classificação</th><th>Status</th><th>Próximo follow-up</th><th>Atualizado</th></tr></thead><tbody>{shownLeads.map((lead) => <tr key={lead.id} className="hover:bg-slate-50"><td><Link href={`/leads/${lead.id}`} className="font-medium text-brand hover:underline">{lead.companyName}</Link></td><td>{[lead.city, lead.region].filter(Boolean).join(" · ") || "—"}</td><td>{lead.segment || "—"}</td><td className="font-semibold">{lead.qualificationScore}/10</td><td><ClassificationBadge classification={getLeadClassification(lead.qualificationScore)} /></td><td><StatusBadge status={lead.status} /></td><td className={isOverdueFollowUp(lead.nextFollowUpAt) ? "font-medium text-red-700" : ""}>{formatDate(lead.nextFollowUpAt)}</td><td>{formatDate(lead.updatedAt)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
