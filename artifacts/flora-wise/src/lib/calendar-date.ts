export interface CalendarCell {
  dateKey: string | null;
  day: number | null;
}

export function kyivDateKey(date: Date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function calendarDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function getMonthCells(year: number, month: number): CalendarCell[] {
  const dayCount = daysInCalendarMonth(year, month);
  const mondayFirstOffset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((mondayFirstOffset + dayCount) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - mondayFirstOffset + 1;
    return day < 1 || day > dayCount
      ? { dateKey: null, day: null }
      : { dateKey: calendarDateKey(year, month, day), day };
  });
}

export function shiftCalendarMonth(year: number, month: number, delta: number, selectedDay: number) {
  const target = new Date(Date.UTC(year, month - 1 + delta, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const targetDay = Math.min(selectedDay, daysInCalendarMonth(targetYear, targetMonth));
  return {
    year: targetYear,
    month: targetMonth,
    day: targetDay,
    dateKey: calendarDateKey(targetYear, targetMonth, targetDay),
  };
}

export function formatMonthTitle(year: number, month: number): string {
  const title = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return title.replace(/\s+р\.$/u, "").replace(/^./u, first => first.toLocaleUpperCase("uk-UA"));
}

export function formatCalendarDate(dateKey: string, options: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}): string {
  return new Intl.DateTimeFormat("uk-UA", { ...options, timeZone: "UTC" })
    .format(new Date(`${dateKey}T12:00:00.000Z`));
}
