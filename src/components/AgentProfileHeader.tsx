import Image from "next/image";

import type { AgentProfile } from "@/lib/agents/registry";

export function AgentProfileHeader({ profile }: { profile: AgentProfile }) {
  return (
    <header className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#18261f] via-[#244336] to-[#315d49] px-5 py-7 text-white sm:px-7 sm:py-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Image
            src={profile.avatar}
            alt={`Avatar de ${profile.displayName}`}
            width={224}
            height={224}
            priority
            className="h-36 w-36 rounded-2xl border-4 border-white/25 object-cover shadow-lg sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Perfil do agente</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{profile.displayName}</h1>
                <p className="mt-2 text-base font-medium text-emerald-50">{profile.role}</p>
                <p className="mt-1 text-sm text-emerald-100/85">{profile.department}</p>
              </div>
              <span className="rounded-full border border-emerald-100/30 bg-white/10 px-3 py-1 text-sm font-medium text-white">
                Status: {profile.lifecycleLabel}
              </span>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-emerald-50/90">{profile.description}</p>
            <p className="mt-4 text-xs text-emerald-100/75">Identidade técnica: <code className="font-medium text-white">{profile.technicalId}</code></p>
          </div>
        </div>
      </div>
    </header>
  );
}
