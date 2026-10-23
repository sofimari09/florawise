export type TaskNotificationKind = "UPCOMING_TASK" | "OVERDUE_TASK";

export function isCurrentRealWeatherNotification(input: {
  recommendationType: string;
  relatedTaskId: number | null;
  applied: boolean;
  superseded: boolean;
  generatedAtMs: number;
  nowMs: number;
  weatherIsMock: unknown;
  hasDevelopmentScenario: boolean;
  maxAgeMs: number;
}) {
  return ["WEATHER_RESCHEDULE", "WEATHER_WARNING"].includes(input.recommendationType) &&
    input.relatedTaskId !== null &&
    !input.applied &&
    !input.superseded &&
    input.generatedAtMs >= input.nowMs - input.maxAgeMs &&
    input.weatherIsMock === false &&
    !input.hasDevelopmentScenario;
}

export function taskNotificationKind(input: {
  status: string;
  scheduledDate: string;
  reminderDate?: string;
  today: string;
  tomorrow: string;
}): TaskNotificationKind | null {
  if (!["PLANNED", "POSTPONED"].includes(input.status)) return null;
  if (input.scheduledDate < input.today) return "OVERDUE_TASK";
  if (input.scheduledDate <= input.tomorrow && input.reminderDate === input.scheduledDate) return "UPCOMING_TASK";
  return null;
}

export function taskNotificationDedupeKey(kind: TaskNotificationKind, taskId: number, scheduledDate: string) {
  return `${kind.toLowerCase()}:${taskId}:${scheduledDate}`;
}

export function notificationDateLabel(date: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00.000Z`));
}

export function notificationEventHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
