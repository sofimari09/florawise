export function shortWeatherLocationName(displayName: string): string {
  return displayName.split(",")[0]?.trim() || displayName.trim();
}

export function roundWeatherTemperature(temperature: number): number {
  return Math.round(temperature);
}
