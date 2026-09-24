import Link from "next/link";

import { AgentProfileHeader } from "@/components/AgentProfileHeader";
import { AgentPromptPanel } from "@/components/AgentPromptPanel";
import { AgentProfileTabs } from "@/components/AgentProfileTabs";
import {
  agentProfileExecutionsEmptyMessage,
  agentProfileMemoryDescription,
  agentProfileSkillsEmptyMessage,
  loadTeamAgentProfile,
  parseAgentProfileTab,
} from "@/lib/team-agent-profile";
import { getAgentPromptConfiguration, toAgentPromptConfigurationDto } from "@/lib/agent-prompt-config";

type TeamAgentProfilePageProps = {
  params: Promise<{ technicalId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function TeamAgentProfilePage({ params, searchParams }: TeamAgentProfilePageProps) {
  const { technicalId } = await params;
  const { tab } = await searchParams;
  const profile = await loadTeamAgentProfile(technicalId);
  const activeTab = parseAgentProfileTab(tab);
  const promptConfiguration = activeTab === "prompt"
    ? toAgentPromptConfigurationDto(await getAgentPromptConfiguration(profile.technicalId))
    : null;

  return (
    <div className="page">
      <Link href="/team" className="mb-4 inline-flex text-sm font-medium text-brand hover:underline">← Voltar para equipe</Link>
      <AgentProfileHeader profile={profile} />

      <div className="mt-6">
        <AgentProfileTabs technicalId={profile.technicalId} activeTab={activeTab} />
        <div className="pt-6">
          {activeTab === "overview" && (
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="panel-pad">
                <h2 className="section-title">Responsável por</h2>
                <ul className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-2">
                  {profile.responsibilities.map((responsibility) => <li className="rounded-lg border border-line bg-slate-50 px-3 py-2" key={responsibility}>• {responsibility}</li>)}
                </ul>
              </div>
              <div className="panel-pad">
                <h2 className="section-title">Não faz</h2>
                <ul className="mt-4 space-y-2 text-sm text-muted">
                  {profile.nonResponsibilities.map((responsibility) => <li key={responsibility}>• {responsibility}</li>)}
                </ul>
                <dl className="mt-6 border-t border-line pt-5 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-muted">Technical identity</dt><dd className="font-medium"><code>{profile.technicalId}</code></dd></div>
                  <div className="mt-3 flex justify-between gap-4"><dt className="text-muted">Lifecycle</dt><dd className="font-medium">{profile.lifecycleLabel}</dd></div>
                </dl>
              </div>
            </section>
          )}

          {activeTab === "prompt" && (
            promptConfiguration && <AgentPromptPanel initialConfiguration={promptConfiguration} />
          )}

          {activeTab === "skills" && (
            <section className="panel-pad max-w-3xl">
              <h2 className="section-title">Skills</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{agentProfileSkillsEmptyMessage}</p>
              <p className="mt-3 text-sm leading-6 text-muted">Skills futuras serão capacidades e instruções especializadas associadas ao <code>{profile.technicalId}</code>.</p>
            </section>
          )}

          {activeTab === "memory" && (
            <section className="grid gap-5 lg:grid-cols-2">
              <div className="panel-pad">
                <h2 className="section-title">Memória de negócio</h2>
                <p className="mt-2 text-sm text-muted">CRM/D1</p>
                <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-muted"><li>• Leads</li><li>• Evidências</li><li>• Pesquisas aprovadas</li><li>• Atividades</li></ul>
              </div>
              <div className="panel-pad">
                <h2 className="section-title">Memória operacional do agente</h2>
                <p className="mt-3 text-sm leading-6 text-muted">Ainda não configurada.</p>
                <p className="mt-3 text-sm leading-6 text-muted">{agentProfileMemoryDescription}</p>
              </div>
            </section>
          )}

          {activeTab === "executions" && (
            <section className="panel-pad max-w-3xl">
              <h2 className="section-title">Execuções</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{agentProfileExecutionsEmptyMessage}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
