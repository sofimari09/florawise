import type { CareTask, Plant, Recommendation, ReportDetailsSnapshot } from "@workspace/db";
import { CARE_LABELS } from "@workspace/plant-care";

export interface CareReportMetrics {
  taskCount: number;
  completed: number;
  overdue: number;
  postponed: number;
  cancelled: number;
  completionRate: number;
  frequentCategory: string;
  mostActivePlant: string;
  recommendationSummary: string;
}

function kyivDateKey(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sortedCounts(counts: Map<string, number>) {
  return [...counts].map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "uk"));
}

export function calculateCareReport(input: {
  plants: Plant[];
  tasks: CareTask[];
  recommendations: Recommendation[];
  periodStart: string;
  periodEnd: string;
  createdAt: Date;
}): { reportDetails: ReportDetailsSnapshot; metrics: CareReportMetrics } {
  const plantsById = new Map(input.plants.map(plant => [plant.id, plant]));
  const includedTasks = input.tasks
    .filter(task => task.scheduledDate >= input.periodStart && task.scheduledDate <= input.periodEnd)
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.id - right.id);
  const asOfDate = kyivDateKey(input.createdAt);
  const tasks = includedTasks.map(task => {
    const plant = plantsById.get(task.plantId);
    const isOverdue = ["PLANNED", "POSTPONED"].includes(task.status) && task.scheduledDate < asOfDate;
    return {
      taskId: task.id,
      plantId: task.plantId,
      plantName: plant?.name ?? "Рослина",
      careType: task.type,
      scheduledDate: task.scheduledDate,
      priority: task.priority,
      status: task.status,
      isOverdue,
    };
  });
  const countedTasks = tasks.filter(task => task.status !== "CANCELLED");
  const byType = new Map<string, number>();
  const byPlant = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const task of countedTasks) {
    const careLabel = CARE_LABELS[task.careType as keyof typeof CARE_LABELS] ?? task.careType;
    byType.set(careLabel, (byType.get(careLabel) ?? 0) + 1);
    byPlant.set(task.plantName, (byPlant.get(task.plantName) ?? 0) + 1);
  }
  for (const task of tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);

  const weatherReschedules = input.recommendations
    .filter(recommendation =>
      recommendation.type === "WEATHER_RESCHEDULE" &&
      recommendation.applied &&
      recommendation.appliedAt !== null &&
      recommendation.originalDate !== null &&
      recommendation.suggestedDate !== null &&
      kyivDateKey(recommendation.appliedAt) >= input.periodStart &&
      kyivDateKey(recommendation.appliedAt) <= input.periodEnd)
    .sort((left, right) => (left.appliedAt?.getTime() ?? 0) - (right.appliedAt?.getTime() ?? 0))
    .map(recommendation => ({
      recommendationId: recommendation.id,
      plantName: plantsById.get(recommendation.plantId)?.name ?? "Рослина",
      originalDate: recommendation.originalDate!,
      suggestedDate: recommendation.suggestedDate!,
      appliedAt: recommendation.appliedAt!.toISOString(),
    }));

  const reportDetails: ReportDetailsSnapshot = {
    cancelled: tasks.length - countedTasks.length,
    byType: sortedCounts(byType),
    byPlant: sortedCounts(byPlant),
    byStatus: sortedCounts(byStatus),
    tasks,
    weatherReschedules,
  };
  const completed = countedTasks.filter(task => task.status === "COMPLETED").length;
  const frequentCategory = reportDetails.byType[0]?.label ?? "Немає завдань";
  const mostActivePlant = reportDetails.byPlant[0]?.label ?? "Немає завдань";

  return {
    reportDetails,
    metrics: {
      taskCount: countedTasks.length,
      completed,
      overdue: tasks.filter(task => task.isOverdue).length,
      postponed: countedTasks.filter(task => task.status === "POSTPONED").length,
      cancelled: reportDetails.cancelled,
      completionRate: countedTasks.length ? Math.round((completed / countedTasks.length) * 100) : 0,
      frequentCategory,
      mostActivePlant,
      recommendationSummary: weatherReschedules.length
        ? `За період застосовано погодних перенесень: ${weatherReschedules.length}.`
        : "За період застосованих погодних перенесень не зафіксовано.",
    },
  };
}
