export const agentLifecycleStatuses = [
  "PLANNED",
  "BUILDING",
  "ACTIVE",
  "PAUSED",
  "RETIRED",
] as const;

export type AgentLifecycleStatus = (typeof agentLifecycleStatuses)[number];

export type AgentProfile = Readonly<{
  technicalId: string;
  displayName: string;
  role: string;
  department: string;
  description: string;
  avatar: string;
  lifecycleStatus: AgentLifecycleStatus;
  lifecycleLabel: string;
  responsibilities: readonly string[];
  nonResponsibilities: readonly string[];
}>;

/** Generic labels are available for future profiles; a profile may choose its own presentation label. */
export const agentLifecycleStatusLabels: Readonly<Record<AgentLifecycleStatus, string>> = Object.freeze({
  PLANNED: "Planejado",
  BUILDING: "Em construção",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  RETIRED: "Encerrado",
});

const researcherProfile: AgentProfile = Object.freeze({
  technicalId: "researcher",
  displayName: "Ana",
  role: "Research Analyst",
  department: "Inteligência de Mercado",
  description: "Ana pesquisa empresas e suas fontes públicas disponíveis, transforma informações observáveis em evidências verificáveis e registra o que conseguiu ou não confirmar.",
  avatar: "/agents/ana.png",
  lifecycleStatus: "ACTIVE",
  lifecycleLabel: "Ativa",
  responsibilities: Object.freeze([
    "Pesquisa factual de empresas",
    "Observação de fontes",
    "Evidências verificáveis",
    "Registro de informações não confirmadas",
  ]),
  nonResponsibilities: Object.freeze([
    "Scoring",
    "Interpretação comercial",
    "Priorização",
    "Estratégia",
    "Outreach",
  ]),
});

/** Organizational identity only: never use these display fields as runtime integration identifiers. */
export const agentRegistry: readonly AgentProfile[] = Object.freeze([researcherProfile]);

export function getAgentProfile(technicalId: string): AgentProfile | undefined {
  return agentRegistry.find((profile) => profile.technicalId === technicalId);
}
