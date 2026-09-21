"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/leads", label: "Leads", icon: "◎" },
  { href: "/finance", label: "Financeiro", icon: "R$" },
  { href: "/assistant", label: "Hermes", icon: "AI" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 z-20 border-b border-slate-800 bg-[#18261f] text-white lg:h-screen lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex h-14 items-center px-4 lg:h-20 lg:px-6">
        <Link href="/dashboard" className="font-bold tracking-[0.14em] text-white">
          STANDLOUD
        </Link>
        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-100">CRM</span>
      </div>
      <nav aria-label="Navegação principal" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-3">
        {links.map((link) => {
          const active = pathname === link.href || (link.href === "/leads" && pathname.startsWith("/leads/"));
          return (
            <Link key={link.href} href={link.href} className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-white/14 text-white" : "text-emerald-50/75 hover:bg-white/10 hover:text-white"}`}>
              <span aria-hidden="true" className="w-5 text-center text-xs">{link.icon}</span>{link.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pt-2"><LogoutButton /></div>
      <p className="hidden px-6 pt-8 text-xs leading-5 text-emerald-50/50 lg:block">Operação comercial interna<br />STANDLOUD</p>
    </aside>
  );
}
