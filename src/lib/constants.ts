import type { ActivityChannel, ActivityType, ProjectStatus } from "@/generated/prisma/enums";

export const activityTypeLabels: Record<ActivityType, string> = {
  NOTE: "Observação",
  CONTACT: "Contato",
  FOLLOW_UP: "Follow-up",
  REPLY: "Resposta",
  DEMO: "Demo",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
  STATUS_CHANGE: "Mudança de status",
};

export const activityChannelLabels: Record<ActivityChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  OTHER: "Outro",
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  ACTIVE: "Ativo",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

export const activityTypes = Object.keys(activityTypeLabels) as ActivityType[];
export const activityChannels = Object.keys(activityChannelLabels) as ActivityChannel[];
export const projectStatuses = Object.keys(projectStatusLabels) as ProjectStatus[];
