import type { Prisma } from "@/generated/prisma/client";
import type { ActivityChannel, ActivityType, LeadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getLeadClassification, leadStatusLabels } from "@/lib/lead";
import { ServiceNotFoundError } from "./errors";

export type LeadListFilters = {
  status?: LeadStatus;
  classification?: "A" | "B" | "C";
  segment?: string;
  city?: string;
  minScore?: number;
  maxScore?: number;
  followUpPending?: boolean;
  limit: number;
};

export type LeadActivityInput = {
  type: ActivityType;
  channel?: ActivityChannel;
  note: string;
  /** Internal callers may preserve the original event time during imports. */
  createdAt?: Date;
};

export type LeadMutationOutcome<T> = {
  result: T;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
};

function classificationScoreRange(classification?: LeadListFilters["classification"]) {
  if (classification === "A") return { min: 8, max: 10 };
  if (classification === "B") return { min: 5, max: 7 };
  if (classification === "C") return { min: 0, max: 4 };
  return { min: 0, max: 10 };
}

function toLeadListItem(lead: {
  id: string;
  companyName: string;
  city: string | null;
  region: string | null;
  segment: string | null;
  qualificationScore: number;
  status: LeadStatus;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  updatedAt: Date;
}) {
  return {
    ...lead,
    classification: getLeadClassification(lead.qualificationScore),
  };
}

export async function listLeads(filters: LeadListFilters) {
  const classificationRange = classificationScoreRange(filters.classification);
  const minScore = Math.max(classificationRange.min, filters.minScore ?? 0);
  const maxScore = Math.min(classificationRange.max, filters.maxScore ?? 10);
  const where: Prisma.LeadWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.segment ? { segment: { contains: filters.segment } } : {}),
    ...(filters.city ? { city: { contains: filters.city } } : {}),
    ...(filters.followUpPending ? { nextFollowUpAt: { not: null } } : {}),
    qualificationScore: { gte: minScore, lte: maxScore },
  };

  const leads = await db.lead.findMany({
    where,
    take: filters.limit,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      companyName: true,
      city: true,
      region: true,
      segment: true,
      qualificationScore: true,
      status: true,
      lastContactAt: true,
      nextFollowUpAt: true,
      updatedAt: true,
    },
  });

  return leads.map(toLeadListItem);
}

export async function getLeadDetail(leadId: string) {
  return db.lead.findUnique({
    where: { id: leadId },
    include: {
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

async function requireLead(leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new ServiceNotFoundError("Lead");
  return lead;
}

function isContactActivity(type: ActivityType) {
  return type === "CONTACT" || type === "REPLY";
}

export async function addLeadActivity(
  leadId: string,
  input: LeadActivityInput,
) {
  await requireLead(leadId);
  const createdAt = input.createdAt ?? new Date();
  const activityData = {
    leadId,
    type: input.type,
    ...(input.channel ? { channel: input.channel } : {}),
    note: input.note,
    createdAt,
  };
  const activity = isContactActivity(input.type)
    ? (await db.$transaction([
      db.leadActivity.create({ data: activityData }),
      db.lead.updateMany({
        where: {
          id: leadId,
          OR: [
            { lastContactAt: null },
            { lastContactAt: { lt: createdAt } },
          ],
        },
        data: { lastContactAt: createdAt },
      }),
    ]))[0]
    : await db.leadActivity.create({ data: activityData });
  return {
    result: { activity },
    beforeData: {},
    afterData: {
      activityId: activity.id,
      type: activity.type,
      channel: activity.channel,
    },
  };
}

export async function addLeadNote(
  leadId: string,
  note: string,
) {
  return addLeadActivity(leadId, { type: "NOTE", note });
}

export async function setLeadStatus(
  leadId: string,
  status: LeadStatus,
): Promise<LeadMutationOutcome<{ status: LeadStatus; changed: boolean }>> {
  const current = await requireLead(leadId);
  const beforeData = { status: current.status };
  if (current.status === status) {
    return {
      result: { status, changed: false },
      beforeData,
      afterData: { status },
    };
  }

  await db.lead.update({ where: { id: leadId }, data: { status } });
  await addLeadActivity(leadId, {
    type: "STATUS_CHANGE",
    note: `Status alterado de ${leadStatusLabels[current.status]} para ${leadStatusLabels[status]}.`,
  });
  return {
    result: { status, changed: true },
    beforeData,
    afterData: { status },
  };
}

export async function setLeadFollowUp(
  leadId: string,
  nextFollowUpAt: Date,
): Promise<LeadMutationOutcome<{ nextFollowUpAt: Date; changed: boolean }>> {
  const current = await requireLead(leadId);
  const beforeValue = current.nextFollowUpAt?.toISOString() ?? null;
  const afterValue = nextFollowUpAt.toISOString();
  if (beforeValue === afterValue) {
    return {
      result: { nextFollowUpAt, changed: false },
      beforeData: { nextFollowUpAt: beforeValue },
      afterData: { nextFollowUpAt: afterValue },
    };
  }
  await db.lead.update({ where: { id: leadId }, data: { nextFollowUpAt } });
  return {
    result: { nextFollowUpAt, changed: true },
    beforeData: { nextFollowUpAt: beforeValue },
    afterData: { nextFollowUpAt: afterValue },
  };
}

export async function updateLeadQualification(
  leadId: string,
  input: { qualificationScore: number; mainProblem?: string },
): Promise<LeadMutationOutcome<{ qualificationScore: number; classification: "A" | "B" | "C"; mainProblem: string | null; changed: boolean }>> {
  const current = await requireLead(leadId);
  const nextMainProblem = input.mainProblem === undefined ? current.mainProblem : input.mainProblem;
  const changed = current.qualificationScore !== input.qualificationScore || current.mainProblem !== nextMainProblem;
  if (changed) {
    await db.lead.update({
      where: { id: leadId },
      data: {
        qualificationScore: input.qualificationScore,
        ...(input.mainProblem !== undefined ? { mainProblem: input.mainProblem } : {}),
      },
    });
  }
  return {
    result: {
      qualificationScore: input.qualificationScore,
      classification: getLeadClassification(input.qualificationScore),
      mainProblem: nextMainProblem,
      changed,
    },
    beforeData: {
      qualificationScore: current.qualificationScore,
      mainProblem: current.mainProblem,
    },
    afterData: {
      qualificationScore: input.qualificationScore,
      mainProblem: nextMainProblem,
    },
  };
}
