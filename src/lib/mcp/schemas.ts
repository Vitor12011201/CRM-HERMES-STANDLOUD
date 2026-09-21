import { ActivityChannel, ActivityType, LeadStatus } from "@/generated/prisma/enums";
import { parseStoredCalendarDate } from "@/lib/business-time";
import { z } from "zod";

const leadIdSchema = z.string().trim().cuid("Informe um identificador de lead valido.").max(64);
const limitSchema = z.coerce.number().int().min(1).max(100);
const shortFilterSchema = z.string().trim().min(1).max(120);
const noteSchema = z.string().trim().min(1, "Informe uma nota.").max(2000);

const followUpDateSchema = z.string().trim().min(10).max(40).refine((value) => {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  return !Number.isNaN(Date.parse(normalized));
}, "Informe uma data ISO valida (AAAA-MM-DD ou data/hora ISO).");

export function parseMcpFollowUpDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseStoredCalendarDate(value) : new Date(value);
}

export const listLeadsInputSchema = z.object({
  status: z.nativeEnum(LeadStatus).optional(),
  classification: z.enum(["A", "B", "C"]).optional(),
  segment: shortFilterSchema.optional(),
  city: shortFilterSchema.optional(),
  minScore: z.coerce.number().int().min(0).max(10).optional(),
  maxScore: z.coerce.number().int().min(0).max(10).optional(),
  followUpPending: z.boolean().optional(),
  limit: limitSchema.default(25),
}).strict().superRefine((value, context) => {
  if (value.minScore !== undefined && value.maxScore !== undefined && value.minScore > value.maxScore) {
    context.addIssue({ code: "custom", message: "A pontuacao minima nao pode ser maior que a maxima.", path: ["minScore"] });
  }
});

export const getLeadInputSchema = z.object({ leadId: leadIdSchema }).strict();

export const dueFollowUpsInputSchema = z.object({
  includeUpcoming: z.boolean().default(false),
  limit: limitSchema.default(25),
}).strict();

export const emptyInputSchema = z.object({}).strict();

export const addLeadNoteInputSchema = z.object({
  leadId: leadIdSchema,
  note: noteSchema,
}).strict();

export const setLeadStatusInputSchema = z.object({
  leadId: leadIdSchema,
  status: z.nativeEnum(LeadStatus),
}).strict();

export const setLeadFollowUpInputSchema = z.object({
  leadId: leadIdSchema,
  nextFollowUpAt: followUpDateSchema,
}).strict();

export const addLeadActivityInputSchema = z.object({
  leadId: leadIdSchema,
  activityType: z.nativeEnum(ActivityType),
  channel: z.nativeEnum(ActivityChannel).optional(),
  note: noteSchema,
}).strict();

export const updateLeadQualificationInputSchema = z.object({
  leadId: leadIdSchema,
  qualificationScore: z.coerce.number().int().min(0).max(10),
  mainProblem: z.string().trim().min(1).max(2000).optional(),
}).strict();
