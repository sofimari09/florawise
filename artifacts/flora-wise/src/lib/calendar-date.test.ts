import { describe, expect, it } from "vitest";
import {
  formatMonthTitle,
  getMonthCells,
  kyivDateKey,
  shiftCalendarMonth,
} from "./calendar-date";

describe("monthly calendar dates", () => {
  it("aligns October 2026 with Thursday in the Monday-first grid", () => {
    const cells = getMonthCells(2026, 10);
    expect(cells[0].dateKey).toBeNull();
    expect(cells[3].dateKey).toBe("2026-10-01");
    expect(formatMonthTitle(2026, 10)).toBe("Жовтень 2026");
  });

  it("handles February 2027 and leap-year February 2028", () => {
    expect(getMonthCells(2027, 2).filter(cell => cell.dateKey).at(-1)?.dateKey).toBe("2027-02-28");
    expect(getMonthCells(2028, 2).filter(cell => cell.dateKey).at(-1)?.dateKey).toBe("2028-02-29");
  });

  it("moves between months and clamps dates that do not exist in the target month", () => {
    expect(shiftCalendarMonth(2026, 10, 1, 31)).toEqual({
      year: 2026, month: 11, day: 30, dateKey: "2026-11-30",
    });
    expect(shiftCalendarMonth(2028, 3, -1, 1)).toEqual({
      year: 2028, month: 2, day: 1, dateKey: "2028-02-01",
    });
  });

  it("keeps date-only task keys stable and derives today's key in Kyiv time", () => {
    expect(kyivDateKey(new Date("2026-10-23T22:30:00.000Z"))).toBe("2026-10-24");
  });
});
