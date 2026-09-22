import {
  addLeadEvidence,
  listLeadEvidenceForDuplicateDetection,
  type LeadEvidenceDuplicateRecord,
  type LeadEvidenceInput,
} from "@/lib/services/lead-research";

import type { ApprovedResearchEvidenceStore, ExactStoredLeadEvidence } from "./evidence-approval";

/** The minimum existing LeadEvidence service surface used by this adapter. */
export type LeadEvidenceApprovalService = {
  listLeadEvidenceForDuplicateDetection(
    leadId: string,
  ): Promise<readonly LeadEvidenceDuplicateRecord[]>;
  addLeadEvidence(
    leadId: string,
    input: LeadEvidenceInput,
    options: { capturedBy: "AGENT" },
  ): Promise<unknown>;
};

const productionLeadEvidenceApprovalService: LeadEvidenceApprovalService = {
  listLeadEvidenceForDuplicateDetection,
  addLeadEvidence,
};

function toExactStoredEvidence(
  evidence: LeadEvidenceDuplicateRecord,
): ExactStoredLeadEvidence {
  return {
    sourceType: evidence.sourceType,
    ...(evidence.sourceUrl === null ? {} : { sourceUrl: evidence.sourceUrl }),
    observation: evidence.observation,
  };
}

/**
 * Concrete bridge from the approved-research port to the existing LeadEvidence
 * service. It deliberately has no method accepting a ResearcherResult.
 */
export function createLeadEvidenceApprovedResearchStore(
  service: LeadEvidenceApprovalService = productionLeadEvidenceApprovalService,
): ApprovedResearchEvidenceStore {
  return {
    async listEvidenceForLead(leadId) {
      const stored = await service.listLeadEvidenceForDuplicateDetection(leadId);
      return stored.map(toExactStoredEvidence);
    },
    createEvidence(leadId, input, options) {
      return service.addLeadEvidence(leadId, input, options);
    },
  };
}
