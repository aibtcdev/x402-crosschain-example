/**
 * Shared Mock Data Generators
 *
 * Provides consistent mock data for demo endpoints.
 */

const WEATHER_CONDITIONS = ["sunny", "cloudy", "rainy"] as const;

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export interface WeatherData {
  city: string;
  temperature: number;
  conditions: WeatherCondition;
}

export interface WeatherResponse extends WeatherData {
  paidWith: string;
  txId?: string;
  note?: string;
}

export interface AiCompletionResponse {
  prompt: string | undefined;
  completion: string;
  tokens: { input: number; output: number };
  paidWith: string;
  txId?: string;
}

/**
 * Generate mock weather data for a city
 */
export function generateWeatherData(city: string): WeatherData {
  return {
    city,
    temperature: Math.floor(Math.random() * 30) + 10,
    conditions: WEATHER_CONDITIONS[Math.floor(Math.random() * 3)],
  };
}

/**
 * Create a weather response with payment info
 */
export function createWeatherResponse(
  city: string,
  paidWith: string,
  txId?: string,
  note?: string
): WeatherResponse {
  return {
    ...generateWeatherData(city),
    paidWith,
    ...(txId && { txId }),
    ...(note && { note }),
  };
}

/**
 * Create a mock AI completion response
 */
export function createAiCompletionResponse(
  prompt: string | undefined,
  paidWith: string,
  txId?: string
): AiCompletionResponse {
  return {
    prompt,
    completion: `This is a mock AI response to: "${prompt}"`,
    tokens: { input: prompt?.length || 0, output: 50 },
    paidWith,
    ...(txId && { txId }),
  };
}
