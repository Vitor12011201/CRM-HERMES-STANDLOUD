import { businessTimeZone, getFollowUpTiming, getStoredCalendarDateKey, isStoredCalendarDate } from "./business-time";

export function formatCurrency(valueInCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valueInCents / 100);
}

export function formatCalendarDate(value?: Date | string | null) {
  if (!value) return "—";
  // Calendar fields are stored as midnight UTC to preserve their YYYY-MM-DD value.
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: businessTimeZone }).format(new Date(value));
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return isStoredCalendarDate(date) ? formatCalendarDate(date) : formatDateTime(date);
}

export function toCalendarDateInputValue(value?: Date | string | null) {
  if (!value) return "";
  return getStoredCalendarDateKey(value);
}

// Kept for existing form consumers; all CRM form dates use the calendar convention above.
export const toDateInputValue = toCalendarDateInputValue;

export function isOverdueFollowUp(value?: Date | string | null, reference = new Date()) {
  return Boolean(value && getFollowUpTiming(value, reference) === "OVERDUE");
}
