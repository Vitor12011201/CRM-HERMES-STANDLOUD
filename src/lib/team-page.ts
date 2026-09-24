import { getAgentProfile, type AgentProfile } from "@/lib/agents/registry";
import { requirePageSession } from "@/lib/auth/server";

/** Loads the organizational profile used by the protected Team page. */
export async function loadTeamPageProfile(): Promise<AgentProfile> {
  await requirePageSession();

  const profile = getAgentProfile("researcher");
  if (!profile) throw new Error("Required organizational agent profile is missing");
  return profile;
}
