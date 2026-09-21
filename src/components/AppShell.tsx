"use client";

import { usePathname } from "next/navigation";
import { AssistantDrawer } from "@/components/AssistantDrawer";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <main className="min-h-screen bg-slate-50 px-4 py-10 sm:flex sm:items-center sm:justify-center">{children}</main>;

  return <div className="min-h-screen lg:flex"><Sidebar /><main className="min-w-0 flex-1">{children}</main><AssistantDrawer /></div>;
}
