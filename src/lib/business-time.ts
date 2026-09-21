export const businessTimeZone = "America/Sao_Paulo";

export type FollowUpTiming = "OVERDUE" | "TODAY" | "UPCOMING";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getDateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;

  return { year: part("year"), month: part("month"), day: part("day") };
}

function toDateKey(parts: { year?: string; month?: string; day?: string }) {
  if (!parts.year || !parts.month || !parts.day) throw new Error("Não foi possível determinar a data operacional.");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getBusinessCalendarDateKey(reference = new Date()) {
  return toDateKey(getDateParts(reference, businessTimeZone));
}

export function getStoredCalendarDateKey(value: Date | string) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseStoredCalendarDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function getBusinessCalendarDayBounds(reference = new Date()) {
  const start = parseStoredCalendarDate(getBusinessCalendarDateKey(reference));
  const nextStart = new Date(start);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);

  return { start, end: new Date(nextStart.getTime() - 1) };
}

export function isStoredCalendarDate(value: Date) {
  return value.getUTCHours() === 0
    && value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0
    && value.getUTCMilliseconds() === 0;
}

export function getFollowUpCalendarDateKey(value: Date | string) {
  const date = new Date(value);
  if (isStoredCalendarDate(date)) return getStoredCalendarDateKey(date);
  return getBusinessCalendarDateKey(date);
}

export function getFollowUpTiming(value: Date | string, reference = new Date()): FollowUpTiming {
  const followUpDate = getFollowUpCalendarDateKey(value);
  const businessDate = getBusinessCalendarDateKey(reference);
  if (followUpDate < businessDate) return "OVERDUE";
  if (followUpDate > businessDate) return "UPCOMING";
  return "TODAY";
}
