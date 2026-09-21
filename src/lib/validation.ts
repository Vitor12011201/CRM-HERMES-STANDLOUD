import { z } from "zod";
import { ActivityChannel, ActivityType, LeadStatus, ProjectStatus } from "@/generated/prisma/enums";

const optionalText = z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().optional());
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().url("Informe uma URL válida.").optional(),
);
const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().email("Informe um e-mail válido.").optional(),
);
const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date({ message: "Informe uma data válida." }).optional(),
);
const optionalInteger = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z.number().int().optional(),
);
const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z.number().finite().optional(),
);

export const leadSchema = z.object({
  companyName: z.string().trim().min(1, "Informe o nome da empresa.").max(160),
  city: optionalText,
  region: optionalText,
  segment: optionalText,
  websiteUrl: optionalUrl,
  googleMapsUrl: optionalUrl,
  instagramUrl: optionalUrl,
  whatsapp: optionalText,
  phone: optionalText,
  email: optionalEmail,
  source: optionalText,
  primaryService: optionalText,
  googleRating: optionalNumber.refine((value) => value === undefined || (value >= 0 && value <= 5), "A avaliação deve estar entre 0 e 5."),
  googleReviewCount: optionalInteger.refine((value) => value === undefined || value >= 0, "O número de avaliações não pode ser negativo."),
  mainProblem: optionalText,
  qualificationScore: z.coerce.number().int("Use um número inteiro.").min(0, "A pontuação mínima é 0.").max(10, "A pontuação máxima é 10."),
  status: z.nativeEnum(LeadStatus),
  notes: optionalText,
  demoUrl: optionalUrl,
  videoUrl: optionalUrl,
  proposalUrl: optionalUrl,
  lastContactAt: optionalDate,
  nextFollowUpAt: optionalDate,
});

export const activitySchema = z.object({
  type: z.nativeEnum(ActivityType),
  channel: z.preprocess((value) => (value === "" ? undefined : value), z.nativeEnum(ActivityChannel).optional()),
  note: z.string().trim().min(1, "Descreva a atividade.").max(2000),
});

export const projectSchema = z.object({
  leadId: z.preprocess((value) => (value === "" ? undefined : value), z.string().cuid().optional()),
  clientName: z.string().trim().min(1, "Informe o cliente.").max(160),
  projectName: z.string().trim().min(1, "Informe o nome do projeto.").max(160),
  totalAmountCents: z.coerce.number().int().positive("O valor contratado deve ser maior que zero."),
  status: z.nativeEnum(ProjectStatus),
  startDate: optionalDate,
  completionDate: optionalDate,
  notes: optionalText,
});

export const paymentSchema = z.object({
  amountCents: z.coerce.number().int().positive("O pagamento deve ser maior que zero."),
  paidAt: z.coerce.date({ message: "Informe a data do pagamento." }),
  paymentMethod: optionalText,
  notes: optionalText,
});
