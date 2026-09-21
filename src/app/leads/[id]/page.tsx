import Link from "next/link";
import { requirePageSession } from "@/lib/auth/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getLeadClassification } from "@/lib/lead";
import { activityChannelLabels, activityTypeLabels } from "@/lib/constants";
import { formatDate, isOverdueFollowUp } from "@/lib/format";
import { ClassificationBadge, StatusBadge } from "@/components/Badges";
import { LeadForm } from "@/components/LeadForm";
import { ActivityForm } from "@/components/ActivityForm";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { DeleteLeadButton } from "@/components/DeleteLeadButton";

function ExternalLink({ href, label }: { href?: string | null; label: string }) {
  return href ? <a className="text-sm font-medium text-brand hover:underline" href={href} target="_blank" rel="noreferrer">{label} ↗</a> : <span className="text-sm text-slate-400">{label}: não informado</span>;
}

function ContactLink({ value, kind }: { value?: string | null; kind: "phone" | "whatsapp" | "email" }) {
  if (!value) return <>—</>;
  const href = kind === "email" ? `mailto:${value}` : kind === "whatsapp" ? `https://wa.me/${value.replace(/\D/g, "")}` : `tel:${value}`;
  return <a className="text-brand hover:underline" href={href} target={kind === "whatsapp" ? "_blank" : undefined} rel={kind === "whatsapp" ? "noreferrer" : undefined}>{value}</a>;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession();
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id }, include: { activities: { orderBy: { createdAt: "desc" } }, projects: { orderBy: { createdAt: "desc" } } } });
  if (!lead) notFound();
  const classification = getLeadClassification(lead.qualificationScore);
  return <div className="page">
    <Link href="/leads" className="mb-4 inline-flex text-sm font-medium text-brand hover:underline">← Voltar para leads</Link>
    <header className="mb-6 flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2 flex flex-wrap gap-2"><ClassificationBadge classification={classification} /><StatusBadge status={lead.status} /></div><h1 className="text-2xl font-semibold tracking-tight text-ink">{lead.companyName}</h1><p className="mt-1 text-sm text-muted">{[lead.city, lead.region, lead.segment].filter(Boolean).join(" · ") || "Empresa em avaliação"}</p></div><div className="flex flex-wrap items-end gap-3"><LeadStatusSelect leadId={lead.id} status={lead.status} /><DeleteLeadButton leadId={lead.id} companyName={lead.companyName} /></div></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="panel-pad"><h2 className="section-title">Empresa</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="muted">Localização</dt><dd className="mt-1 text-sm font-medium">{[lead.city, lead.region].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt className="muted">Segmento</dt><dd className="mt-1 text-sm font-medium">{lead.segment || "—"}</dd></div><div><dt className="muted">Serviço principal</dt><dd className="mt-1 text-sm font-medium">{lead.primaryService || "—"}</dd></div><div><dt className="muted">Telefone</dt><dd className="mt-1 text-sm font-medium"><ContactLink value={lead.phone} kind="phone" /></dd></div><div><dt className="muted">WhatsApp</dt><dd className="mt-1 text-sm font-medium"><ContactLink value={lead.whatsapp} kind="whatsapp" /></dd></div><div><dt className="muted">E-mail</dt><dd className="mt-1 break-all text-sm font-medium"><ContactLink value={lead.email} kind="email" /></dd></div></dl><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2"><ExternalLink href={lead.websiteUrl} label="Site" /><ExternalLink href={lead.googleMapsUrl} label="Google Maps" /><ExternalLink href={lead.instagramUrl} label="Instagram" /></div></section>
        <section className="panel-pad"><h2 className="section-title">Qualificação</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="muted">Pontuação</p><p className="mt-1 text-xl font-semibold">{lead.qualificationScore}/10</p></div><div><p className="muted">Classificação</p><p className="mt-1"><ClassificationBadge classification={classification} /></p></div><div><p className="muted">Google</p><p className="mt-1 text-sm font-medium">{lead.googleRating ?? "—"}{lead.googleReviewCount !== null ? ` · ${lead.googleReviewCount} avaliações` : ""}</p></div></div><div className="mt-5"><p className="muted">Principal problema / oportunidade</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{lead.mainProblem || "Não informado."}</p></div></section>
        <section className="panel-pad"><h2 className="section-title">Comercial</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="muted">Origem</dt><dd className="mt-1 text-sm font-medium">{lead.source || "—"}</dd></div><div><dt className="muted">Último contato</dt><dd className="mt-1 text-sm font-medium">{formatDate(lead.lastContactAt)}</dd></div><div><dt className="muted">Próximo follow-up</dt><dd className={`mt-1 text-sm font-medium ${isOverdueFollowUp(lead.nextFollowUpAt) ? "text-red-700" : ""}`}>{formatDate(lead.nextFollowUpAt)}</dd></div></dl><div className="mt-5"><p className="muted">Observações</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{lead.notes || "Nenhuma observação."}</p></div><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2"><ExternalLink href={lead.demoUrl} label="Demo" /><ExternalLink href={lead.videoUrl} label="Vídeo" /><ExternalLink href={lead.proposalUrl} label="Proposta" /></div></section>
        <details className="panel-pad"><summary className="cursor-pointer text-sm font-semibold text-brand">Editar informações do lead</summary><div className="mt-5 border-t border-line pt-5"><LeadForm initial={lead} /></div></details>
      </div>
      <aside className="space-y-5"><section className="panel-pad"><h2 className="section-title">Registrar atividade</h2><p className="mt-1 text-sm text-muted">Registre um contato, resposta ou observação.</p><div className="mt-4"><ActivityForm leadId={lead.id} /></div></section><section className="panel-pad"><h2 className="section-title">Histórico</h2>{lead.activities.length === 0 ? <p className="mt-3 text-sm text-muted">Nenhuma atividade registrada ainda.</p> : <ol className="mt-4 space-y-4">{lead.activities.map((activity) => <li key={activity.id} className="border-l-2 border-emerald-200 pl-3"><div className="flex flex-wrap items-center gap-x-2 text-xs text-muted"><span className="font-semibold text-slate-700">{activityTypeLabels[activity.type]}</span>{activity.channel && <span>· {activityChannelLabels[activity.channel]}</span>}<span>· {formatDate(activity.createdAt)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm leading-5">{activity.note}</p></li>)}</ol>}</section>{lead.projects.length > 0 && <section className="panel-pad"><h2 className="section-title">Projetos vinculados</h2><ul className="mt-3 space-y-2">{lead.projects.map((project) => <li key={project.id} className="text-sm"><Link className="font-medium text-brand hover:underline" href="/finance">{project.projectName}</Link><span className="text-muted"> · {project.clientName}</span></li>)}</ul></section>}</aside>
    </div>
  </div>;
}
