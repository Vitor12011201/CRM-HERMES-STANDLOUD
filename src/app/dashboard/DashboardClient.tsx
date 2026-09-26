"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { DashboardFinanceDto, DashboardFollowUpItemDto, DashboardFollowUpsDto, DashboardFunnelDto } from "@/lib/dashboard-api-data";
import { fetchDashboardData, type DashboardRequestResult } from "@/lib/dashboard-client-data";
import { formatCalendarDate, formatCurrency } from "@/lib/format";

type Resource<T> = { state: "loading" } | { state: "success"; data: T } | { state: "error" };

function toResource<T>(result: DashboardRequestResult<T>): Resource<T> {
  return result.kind === "success" ? { state: "success", data: result.data } : { state: "error" };
}

function percentage(value: number | null) {
  return value === null ? "Sem dados suficientes" : `${value.toFixed(1).replace(".", ",")}%`;
}

function FollowUpList({ items, empty, overdueList = false }: { items: DashboardFollowUpItemDto[]; empty: string; overdueList?: boolean }) {
  if (items.length === 0) return <p className="mt-3 text-sm text-muted">{empty}</p>;
  return <ul className="mt-3 space-y-2">{items.map((lead) => <li key={lead.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><div className="min-w-0"><Link href={`/leads/${lead.id}`} className="block truncate text-sm font-medium text-brand hover:underline">{lead.companyName}</Link><span className="text-xs text-muted">{formatCalendarDate(lead.nextFollowUpAt)}</span></div><span className={overdueList ? "text-xs font-semibold text-red-700" : "text-xs text-muted"}>{overdueList ? "Atrasado" : "Agendado"}</span></li>)}</ul>;
}

function SectionFailure() {
  return <p className="mt-3 text-sm text-red-700">Não foi possível carregar esta seção. Atualize a página para tentar novamente.</p>;
}

export function DashboardClient() {
  const router = useRouter();
  const [funnel, setFunnel] = useState<Resource<DashboardFunnelDto>>({ state: "loading" });
  const [followUps, setFollowUps] = useState<Resource<DashboardFollowUpsDto>>({ state: "loading" });
  const [finance, setFinance] = useState<Resource<DashboardFinanceDto>>({ state: "loading" });

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchDashboardData<DashboardFunnelDto>("/api/dashboard/funnel"),
      fetchDashboardData<DashboardFollowUpsDto>("/api/dashboard/followups"),
      fetchDashboardData<DashboardFinanceDto>("/api/dashboard/finance"),
    ]).then(([funnelResult, followUpsResult, financeResult]) => {
      if (!active) return;
      if ([funnelResult, followUpsResult, financeResult].some((result) => result.kind === "unauthorized")) {
        router.replace("/login");
        return;
      }
      setFunnel(toResource(funnelResult));
      setFollowUps(toResource(followUpsResult));
      setFinance(toResource(financeResult));
    });
    return () => { active = false; };
  }, [router]);

  if (funnel.state === "success" && funnel.data.totalLeads === 0) {
    return <div className="panel-pad p-10 text-center"><p className="font-medium">Nenhum lead ainda. Adicione seu primeiro prospect.</p><Link href="/leads" className="mt-3 inline-flex text-sm font-medium text-brand hover:underline">Ir para leads →</Link></div>;
  }

  const funnelData = funnel.state === "success" ? funnel.data : null;
  const counts = [
    { label: "Total de leads", value: funnelData?.totalLeads },
    { label: "Leads A", value: funnelData?.classA },
    { label: "Leads B", value: funnelData?.classB },
    { label: "Leads C", value: funnelData?.classC },
    { label: "Contatados", value: funnelData?.contacted },
    { label: "Respostas", value: funnelData?.replied },
    { label: "Interessados", value: funnelData?.interested },
    { label: "Propostas", value: funnelData?.proposals },
    { label: "Ganhos", value: funnelData?.won },
    { label: "Perdidos", value: funnelData?.lost },
  ];
  const rates = funnelData ? [
    { label: "Taxa de resposta", value: percentage(funnelData.responseRate) },
    { label: "Taxa de interesse", value: percentage(funnelData.interestRate) },
    { label: "Taxa de proposta", value: percentage(funnelData.proposalRate) },
    { label: "Conversão lead → cliente", value: percentage(funnelData.conversionRate) },
  ] : [];
  const followUpData = followUps.state === "success" ? followUps.data : null;
  const financeData = finance.state === "success" ? finance.data : null;

  return <>
    <section><h2 className="mb-3 text-sm font-semibold">Funil comercial</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{counts.map((item) => <div className="panel-pad" key={item.label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p><p className="mt-1 text-2xl font-semibold">{item.value ?? "—"}</p></div>)}</div>{funnel.state === "loading" ? <p className="mt-3 text-sm text-muted">Carregando funil comercial…</p> : null}{funnel.state === "error" ? <SectionFailure /> : null}</section>
    <div className="mt-6 grid gap-5 xl:grid-cols-3">
      <section className="panel-pad"><h2 className="section-title">Follow-ups atrasados <span className="text-red-700">({followUpData?.overdue.count ?? "—"})</span></h2>{followUps.state === "success" ? <FollowUpList items={followUpData!.overdue.items} empty="Nenhum follow-up atrasado." overdueList /> : followUps.state === "loading" ? <p className="mt-3 text-sm text-muted">Carregando follow-ups…</p> : <SectionFailure />}</section>
      <section className="panel-pad"><h2 className="section-title">Para hoje <span className="text-amber-700">({followUpData?.today.count ?? "—"})</span></h2>{followUps.state === "success" ? <FollowUpList items={followUpData!.today.items} empty="Nenhum follow-up para hoje." /> : followUps.state === "loading" ? <p className="mt-3 text-sm text-muted">Carregando follow-ups…</p> : <SectionFailure />}</section>
      <section className="panel-pad"><h2 className="section-title">Próximos follow-ups</h2>{followUps.state === "success" ? <FollowUpList items={followUpData!.upcoming.items} empty="Nenhum follow-up agendado." /> : followUps.state === "loading" ? <p className="mt-3 text-sm text-muted">Carregando follow-ups…</p> : <SectionFailure />}</section>
    </div>
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="panel-pad"><h2 className="section-title">Métricas do funil</h2><p className="mt-1 text-sm text-muted">Estágios avançados contam os marcos comerciais anteriores alcançados.</p>{funnel.state === "success" ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{rates.map((item) => <div className="rounded-md border border-line p-3" key={item.label}><p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p><p className="mt-1 text-lg font-semibold">{item.value}</p></div>)}</div> : funnel.state === "loading" ? <p className="mt-4 text-sm text-muted">Carregando métricas…</p> : <SectionFailure />}</section>
      <section className="panel-pad"><h2 className="section-title">Resumo financeiro</h2>{finance.state === "success" ? <><dl className="mt-4 space-y-3"><div className="flex justify-between gap-3"><dt className="text-sm text-muted">Receita contratada</dt><dd className="font-semibold">{formatCurrency(financeData!.contractedCents)}</dd></div><div className="flex justify-between gap-3"><dt className="text-sm text-muted">Receita recebida</dt><dd className="font-semibold text-emerald-700">{formatCurrency(financeData!.receivedCents)}</dd></div><div className="flex justify-between gap-3 border-t border-line pt-3"><dt className="text-sm font-medium">Saldo pendente</dt><dd className="font-semibold text-amber-700">{formatCurrency(financeData!.outstandingCents)}</dd></div></dl><Link className="mt-5 inline-flex text-sm font-medium text-brand hover:underline" href="/finance">Abrir financeiro →</Link></> : finance.state === "loading" ? <p className="mt-4 text-sm text-muted">Carregando resumo financeiro…</p> : <SectionFailure />}</section>
    </div>
  </>;
}
