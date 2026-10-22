export function todayInKyiv(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateInKyivOffset(offsetDays: number, fromDate = todayInKyiv()): string {
  return new Date(Date.parse(`${fromDate}T00:00:00.000Z`) + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
