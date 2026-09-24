import Image from "next/image";
import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";
import { loadTeamPageProfile } from "@/lib/team-page";

export default async function TeamPage() {
  const ana = await loadTeamPageProfile();

  return (
    <div className="page">
      <PageHeader title="Equipe" description="A equipe agêntica da STANDLOUD e as responsabilidades de cada especialista." />

      <section aria-label="Diretório da equipe" className="max-w-3xl">
        <article className="group overflow-hidden rounded-xl border border-line bg-white shadow-sm transition hover:border-emerald-200 hover:shadow-md">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <Image
              src={ana.avatar}
              alt={`Avatar de ${ana.displayName}`}
              width={144}
              height={144}
              priority
              className="h-28 w-28 rounded-2xl border border-line object-cover shadow-sm sm:h-32 sm:w-32"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-ink">{ana.displayName}</h2>
                  <p className="mt-1 font-medium text-brand">{ana.role}</p>
                  <p className="mt-1 text-sm text-muted">{ana.department}</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                  {ana.lifecycleLabel}
                </span>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted">{ana.description}</p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">Identidade técnica: <code>{ana.technicalId}</code></p>
                <Link href={`/team/${ana.technicalId}`} className="button-secondary">Abrir perfil</Link>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
