import { describe, expect, it } from "vitest";

import {
  getBusinessCalendarDateKey,
  getBusinessCalendarDayBounds,
  getFollowUpTiming,
  getFollowUpTimingForBusinessDate,
  parseStoredCalendarDate,
} from "./business-time";
import { formatCalendarDate, formatDate, isOverdueFollowUp, toCalendarDateInputValue } from "./format";

describe("business calendar in America/Sao_Paulo", () => {
  it("uses the local business date before and after the UTC day changes", () => {
    expect(getBusinessCalendarDateKey(new Date("2026-09-21T15:00:00.000Z"))).toBe("2026-09-21");
    expect(getBusinessCalendarDateKey(new Date("2026-09-22T00:30:00.000Z"))).toBe("2026-09-21");

    const bounds = getBusinessCalendarDayBounds(new Date("2026-09-22T00:30:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-09-21T23:59:59.999Z");
  });

  it("classifies yesterday, today and tomorrow by the business calendar", () => {
    const reference = new Date("2026-09-22T00:30:00.000Z");
    const businessDate = getBusinessCalendarDateKey(reference);

    expect(getFollowUpTiming(parseStoredCalendarDate("2026-09-20"), reference)).toBe("OVERDUE");
    expect(getFollowUpTiming(parseStoredCalendarDate("2026-09-21"), reference)).toBe("TODAY");
    expect(getFollowUpTiming(parseStoredCalendarDate("2026-09-22"), reference)).toBe("UPCOMING");
    expect(getFollowUpTimingForBusinessDate(parseStoredCalendarDate("2026-09-20"), businessDate)).toBe("OVERDUE");
    expect(getFollowUpTimingForBusinessDate(parseStoredCalendarDate("2026-09-21"), businessDate)).toBe("TODAY");
    expect(getFollowUpTimingForBusinessDate(parseStoredCalendarDate("2026-09-22"), businessDate)).toBe("UPCOMING");
    expect(isOverdueFollowUp(parseStoredCalendarDate("2026-09-20"), reference)).toBe(true);
    expect(isOverdueFollowUp(parseStoredCalendarDate("2026-09-21"), reference)).toBe(false);
  });

  it("preserves calendar values stored at midnight UTC without shifting the displayed day", () => {
    const storedValue = parseStoredCalendarDate("2026-09-21");

    expect(toCalendarDateInputValue(storedValue)).toBe("2026-09-21");
    expect(formatCalendarDate(storedValue)).toBe("21/09/2026");
    expect(formatDate(new Date("2026-09-22T00:30:00.000Z"))).toContain("21");
  });
});
