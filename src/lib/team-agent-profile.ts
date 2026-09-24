import { notFound } from "next/navigation";

import { getAgentProfile, type AgentProfile } from "@/lib/agents/registry";
import { requirePageSession } from "@/lib/auth/server";

export const agentProfileTabs = [
  { id: "overview", label: "Visão geral" },
  { id: "prompt", label: "Prompt" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memória" },
  { id: "executions", label: "Execuções" },
] as const;

export type AgentProfileTab = (typeof agentProfileTabs)[number]["id"];

export const agentProfileSkillsEmptyMessage =
  "Nenhuma skill versionada específica da Ana foi registrada ainda.";

export const agentProfileMemoryDescription =
  "Dados comerciais não serão duplicados em uma memória paralela da Ana.";

export const agentProfileExecutionsEmptyMessage =
  "Histórico operacional detalhado ainda não está conectado a este perfil.";

export function parseAgentProfileTab(value: string | string[] | undefined): AgentProfileTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return agentProfileTabs.some((item) => item.id === tab) ? tab as AgentProfileTab : "overview";
}

/** Loads an organizational profile from the registry; unknown technical IDs are a true 404. */
export async function loadTeamAgentProfile(technicalId: string): Promise<AgentProfile> {
  await requirePageSession();

  const profile = getAgentProfile(technicalId);
  if (!profile) notFound();
  return profile;
}
