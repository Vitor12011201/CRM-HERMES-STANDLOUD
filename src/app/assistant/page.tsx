import { AssistantChat } from "@/components/AssistantChat";
import { PageHeader } from "@/components/PageHeader";
import { requirePageSession } from "@/lib/auth/server";

export default async function AssistantPage() {
  await requirePageSession();

  return (
    <div className="page">
      <PageHeader title="Hermes" description="Assistente para consultas e alterações controladas nos dados do CRM." />
      <AssistantChat />
    </div>
  );
}
