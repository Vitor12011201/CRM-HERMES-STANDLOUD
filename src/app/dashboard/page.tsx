import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server";
import type { Lead } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getFunnelMetrics } from "@/lib/dashboard";
import { getFinancialTotals } from "@/lib/finance";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { getFollowUpTiming } from "@/lib/business-time";
import { getLeadClassification } from "@/lib/lead";
import { PageHeader } from "@/components/PageHeader";

function percentage(value: number | null) { return value === null ? "Sem dados suficientes" : `${value.toFixed(1).replace(".", ",")}%`; }

type FollowUpLead = Pick<Lead, "id" | "companyName" | "nextFollowUpAt">;

function FollowUpList({ items, empty, overdueList = false }: { items: FollowUpLead[]; empty: string; overdueList?: boolean }) {
  if (items.length === 0) return <p className="mt-3 text-sm text-muted">{empty}</p>;
  return <ul className="mt-3 space-y-2">{items.map((lead) => <li key={lead.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><div className="min-w-0"><Link href={`/leads/${lead.id}`} className="block truncate text-sm font-medium text-brand hover:underline">{lead.companyName}</Link><span className="text-xs text-muted">{formatCalendarDate(lead.nextFollowUpAt)}</span></div><span className={overdueList ? "text-xs font-semibold text-red-700" : "text-xs text-muted"}>{overdueList ? "Atrasado" : "Agendado"}</span></li>)}</ul>;
}

export default async function DashboardPage() {
  await requirePageSession();
  const db = getDb();
  const [leads, projects] = await Promise.all([db.lead.findMany({ orderBy: { nextFollowUpAt: "asc" } }), db.project.findMany({ include: { payments: true } })]);
  const metrics = getFunnelMetrics(leads);
  const finance = getFinancialTotals(projects.filter((project) => project.status !== "CANCELLED"));
  const reference = new Date();
  const followUps = leads.filter((lead) => lead.nextFollowUpAt); const overdue = followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "OVERDUE"); const today = followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "TODAY"); const upcoming = followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "UPCOMING").slice(0, 6);
  const scoreCounts = { A: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "A").length, B: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "B").length, C: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "C").length };
  const counts = [{ label: "Total de leads", value: leads.length }, { label: "Leads A", value: scoreCounts.A }, { label: "Leads B", value: scoreCounts.B }, { label: "Leads C", value: scoreCounts.C }, { label: "Contatados", value: metrics.contacted }, { label: "Respostas", value: metrics.replied }, { label: "Interessados", value: metrics.interested }, { label: "Propostas", value: metrics.proposals }, { label: "Ganhos", value: metrics.won }, { label: "Perdidos", value: leads.filter((lead) => lead.status === "LOST").length }];
  const rates = [{ label: "Taxa de resposta", value: percentage(metrics.responseRate) }, { label: "Taxa de interesse", value: percentage(metrics.interestRate) }, { label: "Taxa de proposta", value: percentage(metrics.proposalRate) }, { label: "Conversão lead → cliente", value: percentage(metrics.conversionRate) }];
  return <div className="page"><PageHeader title="Dashboard" description="Panorama da operação comercial e financeira." action={<Link href="/leads" className="button-primary">Ver leads</Link>} />{leads.length === 0 ? <div className="panel-pad p-10 text-center"><p className="font-medium">Nenhum lead ainda. Adicione seu primeiro prospect.</p><Link href="/leads" className="mt-3 inline-flex text-sm font-medium text-brand hover:underline">Ir para leads →</Link></div> : <><section><h2 className="mb-3 text-sm font-semibold">Funil comercial</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{counts.map((item) => <div className="panel-pad" key={item.label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p><p className="mt-1 text-2xl font-semibold">{item.value}</p></div>)}</div></section><div className="mt-6 grid gap-5 xl:grid-cols-3"><section className="panel-pad"><h2 className="section-title">Follow-ups atrasados <span className="text-red-700">({overdue.length})</span></h2><FollowUpList items={overdue} empty="Nenhum follow-up atrasado." overdueList /></section><section className="panel-pad"><h2 className="section-title">Para hoje <span className="text-amber-700">({today.length})</span></h2><FollowUpList items={today} empty="Nenhum follow-up para hoje." /></section><section className="panel-pad"><h2 className="section-title">Próximos follow-ups</h2><FollowUpList items={upcoming} empty="Nenhum follow-up agendado." /></section></div><div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]"><section className="panel-pad"><h2 className="section-title">Métricas do funil</h2><p className="mt-1 text-sm text-muted">Estágios avançados contam os marcos comerciais anteriores alcançados.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{rates.map((item) => <div className="rounded-md border border-line p-3" key={item.label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p><p className="mt-1 text-lg font-semibold">{item.value}</p></div>)}</div></section><section className="panel-pad"><h2 className="section-title">Resumo financeiro</h2><dl className="mt-4 space-y-3"><div className="flex justify-between gap-3"><dt className="text-sm text-muted">Receita contratada</dt><dd className="font-semibold">{formatCurrency(finance.contractedCents)}</dd></div><div className="flex justify-between gap-3"><dt className="text-sm text-muted">Receita recebida</dt><dd className="font-semibold text-emerald-700">{formatCurrency(finance.receivedCents)}</dd></div><div className="flex justify-between gap-3 border-t border-line pt-3"><dt className="text-sm font-medium">Saldo pendente</dt><dd className="font-semibold text-amber-700">{formatCurrency(finance.outstandingCents)}</dd></div></dl><Link className="mt-5 inline-flex text-sm font-medium text-brand hover:underline" href="/finance">Abrir financeiro →</Link></section></div></>}</div>;
}
