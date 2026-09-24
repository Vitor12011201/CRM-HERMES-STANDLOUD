import { PageHeader } from "@/components/PageHeader";
import { ScoutWorkflowPanel } from "@/components/ScoutWorkflowPanel";
import { requirePageSession } from "@/lib/auth/server";
import { listActionableScoutCandidateReviews } from "@/lib/scout-candidate-review";

export default async function ScoutPage() {
  await requirePageSession();
  const reviews = await listActionableScoutCandidateReviews();
  return (
    <div className="page">
      <PageHeader title="Scout" description="Descoberta determinística de empresas para revisão humana." />
      <ScoutWorkflowPanel reviews={reviews.map((review) => ({
        id: review.id,
        companyName: review.companyName,
        ...(review.city === undefined ? {} : { city: review.city }),
        ...(review.region === undefined ? {} : { region: review.region }),
        ...(review.segment === undefined ? {} : { segment: review.segment }),
        ...(review.websiteUrl === undefined ? {} : { websiteUrl: review.websiteUrl }),
        source: { type: review.source.type },
        basis: review.basis,
        unresolvedQuestions: review.unresolvedQuestions,
        status: review.status === "APPROVING" ? "APPROVING" : "PENDING",
      }))} />
    </div>
  );
}
