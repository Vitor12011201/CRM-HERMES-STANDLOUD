import Link from "next/link";

import { agentProfileTabs, type AgentProfileTab } from "@/lib/team-agent-profile";

export function AgentProfileTabs({ technicalId, activeTab }: { technicalId: string; activeTab: AgentProfileTab }) {
  return (
    <nav aria-label="Seções do perfil" className="overflow-x-auto border-b border-line">
      <div className="flex min-w-max gap-1">
        {agentProfileTabs.map((tab) => {
          const active = activeTab === tab.id;
          const href = tab.id === "overview" ? `/team/${technicalId}` : `/team/${technicalId}?tab=${tab.id}`;
          return (
            <Link
              key={tab.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-3 py-3 text-sm font-medium transition ${active ? "border-brand text-brand" : "border-transparent text-muted hover:border-slate-300 hover:text-slate-800"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
