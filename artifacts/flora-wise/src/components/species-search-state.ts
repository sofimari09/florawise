export const speciesSearchKey = (text: string) =>
  text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("uk-UA");

export function speciesKeyAction(key: string, active: number, count: number, open: boolean) {
  if (key === "ArrowDown") return { prevent: true, open: true, active: count ? (active + 1) % count : -1 };
  if (key === "ArrowUp") return { prevent: true, open: true, active: count ? (active <= 0 ? count - 1 : active - 1) : -1 };
  if (key === "Escape") return { prevent: true, open: false, active: -1 };
  if (key === "Tab") return { prevent: false, open: false, active: -1 };
  if (key === "Enter") return { prevent: true, open, active, select: open && active >= 0 && active < count ? active : undefined };
  return { prevent: false, open, active };
}
