import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";
import { DashboardClient } from "./DashboardClient";

// This route intentionally renders only a static shell. Authenticated business
// data is fetched client-side from the small, session-protected dashboard APIs.
export const dynamic = "force-static";

export default function DashboardPage() {
  return <div className="page"><PageHeader title="Dashboard" description="Panorama da operação comercial e financeira." action={<Link href="/leads" className="button-primary">Ver leads</Link>} /><DashboardClient /></div>;
}
