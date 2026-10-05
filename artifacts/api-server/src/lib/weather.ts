export type WeatherDay = {
  date: string;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  condition: string;
};

export type WeatherResponse = {
  location: string;
  latitude: number | null;
  longitude: number | null;
  isMock: boolean;
  forecast: WeatherDay[];
};

export type WeatherLocation = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

export interface WeatherServiceClient {
  getForecast(location: WeatherLocation): Promise<WeatherResponse>;
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

export class MockWeatherService implements WeatherServiceClient {
  async getForecast(location: WeatherLocation): Promise<WeatherResponse> {
    const templates = [
      { temperature: 20, precipitation: 0.4, humidity: 57, windSpeed: 3, condition: "Ясно" },
      { temperature: 18, precipitation: 13, humidity: 86, windSpeed: 4, condition: "Значні опади" },
      { temperature: 29, precipitation: 0.2, humidity: 38, windSpeed: 2, condition: "Спекотно й сухо" },
      { temperature: 21, precipitation: 0.8, humidity: 61, windSpeed: 12, condition: "Сильний вітер" },
      { temperature: 22, precipitation: 1.2, humidity: 65, windSpeed: 4, condition: "Хмарно з проясненнями" },
      { temperature: 19, precipitation: 0, humidity: 54, windSpeed: 3, condition: "Комфортно" },
      { temperature: 23, precipitation: 2, humidity: 60, windSpeed: 5, condition: "Мінлива хмарність" },
    ];
    const identity = `${location.name}|${location.latitude ?? ""}|${location.longitude ?? ""}`;
    const hash = [...identity].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    const rotation = hash % templates.length;
    const temperatureOffset = (hash % 7) - 3;
    return {
      location: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      isMock: true,
      forecast: templates.map((_, index) => {
        const day = templates[(index + rotation) % templates.length];
        return { ...day, temperature: day.temperature + temperatureOffset, date: addDays(new Date(), index) };
      }),
    };
  }
}

export const weatherService: WeatherServiceClient = new MockWeatherService();