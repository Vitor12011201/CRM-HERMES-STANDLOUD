export type ScoutReviewApprovalUiState = Readonly<{
  status: "PENDING" | "APPROVING";
  unresolvedQuestions: readonly string[];
}>;

/** Only the first PENDING approval requires a new human acknowledgement. */
export function requiresInitialScoutApprovalAcknowledgement(
  review: ScoutReviewApprovalUiState,
): boolean {
  return review.status === "PENDING" && review.unresolvedQuestions.length > 0;
}
