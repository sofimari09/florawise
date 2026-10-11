import { describe, expect, it } from "vitest";
import { roundWeatherTemperature, shortWeatherLocationName } from "./weather-display";

describe("dashboard weather display", () => {
  it("rounds the current temperature to a whole number", () => {
    expect(roundWeatherTemperature(12.1)).toBe(12);
    expect(roundWeatherTemperature(12.6)).toBe(13);
  });

  it("shows only the first location name segment without changing the stored value", () => {
    expect(shortWeatherLocationName("Забужжя, Львівський район, Львівська область, Україна")).toBe("Забужжя");
    expect(shortWeatherLocationName("  Київ  ")).toBe("Київ");
  });
});
