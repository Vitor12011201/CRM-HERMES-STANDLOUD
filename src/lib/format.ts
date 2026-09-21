export function formatCurrency(valueInCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valueInCents / 100);
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  // Form inputs capture a calendar day, not a timestamp. Keeping this in UTC
  // avoids showing the previous day in Brazil for values stored at midnight.
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function toDateInputValue(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function getUtcDayBounds(reference = new Date()) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(-1);
  return { start, end };
}

export function isOverdueFollowUp(value?: Date | string | null, reference = new Date()) {
  return Boolean(value && new Date(value) < getUtcDayBounds(reference).start);
}
