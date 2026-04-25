import { formatTimeHm } from '../../shared/time-format.mjs';

const LONDON_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=Europe%2FLondon&forecast_days=1';

export function describeWeatherCode(code, isDay = true) {
  const normalized = Number(code);
  if (normalized === 0) return { label: isDay ? 'Clear' : 'Clear night', icon: isDay ? '☀️' : '🌙' };
  if (normalized === 1) return { label: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' };
  if (normalized === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (normalized === 3) return { label: 'Overcast', icon: '☁️' };
  if ([45, 48].includes(normalized)) return { label: 'Fog', icon: '🌫️' };
  if ([51, 53, 55, 56, 57].includes(normalized)) return { label: 'Drizzle', icon: '🌦️' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(normalized)) return { label: 'Rain', icon: '🌧️' };
  if ([71, 73, 75, 77, 85, 86].includes(normalized)) return { label: 'Snow', icon: '🌨️' };
  if ([95, 96, 99].includes(normalized)) return { label: 'Thunderstorm', icon: '⛈️' };
  return { label: 'Conditions unavailable', icon: '☁️' };
}

export function normaliseLondonWeatherPayload(payload) {
  const current = payload?.current;
  if (!current || typeof current !== 'object') {
    throw new Error('Missing current weather data.');
  }
  const isDay = Number(current.is_day) !== 0;
  const descriptor = describeWeatherCode(current.weather_code, isDay);
  return {
    status: 'success',
    temperatureC: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null,
    apparentTemperatureC: Number.isFinite(Number(current.apparent_temperature)) ? Number(current.apparent_temperature) : null,
    windKph: Number.isFinite(Number(current.wind_speed_10m)) ? Number(current.wind_speed_10m) : null,
    conditionLabel: descriptor.label,
    conditionIcon: descriptor.icon,
    isDay,
    observedAt: typeof current.time === 'string' ? current.time : null,
    error: null
  };
}

export async function refreshLondonWeather(state, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    state.londonWeather = {
      ...state.londonWeather,
      status: 'error',
      error: 'Weather unavailable in this browser.'
    };
    return state.londonWeather;
  }
  state.londonWeather = {
    ...state.londonWeather,
    status: 'loading',
    error: null
  };
  try {
    const response = await fetchImpl(`${LONDON_WEATHER_URL}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.londonWeather = normaliseLondonWeatherPayload(await response.json());
    return state.londonWeather;
  } catch (error) {
    state.londonWeather = {
      ...state.londonWeather,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
    return state.londonWeather;
  }
}

export function startLondonWeatherPolling(state, intervalMs, onAfterLoad, fetchImpl = globalThis.fetch) {
  refreshLondonWeather(state, fetchImpl).finally(() => {
    if (typeof onAfterLoad === 'function') onAfterLoad();
  });
  return setInterval(() => {
    refreshLondonWeather(state, fetchImpl).finally(() => {
      if (typeof onAfterLoad === 'function') onAfterLoad();
    });
  }, intervalMs);
}

export function formatLondonWeatherMeta(weather) {
  if (!weather || weather.status === 'idle' || weather.status === 'loading') {
    return 'Checking the latest London conditions.';
  }
  if (weather.status === 'error') {
    return 'London weather is unavailable right now.';
  }
  const parts = [];
  if (Number.isFinite(weather.apparentTemperatureC)) {
    parts.push(`Feels like ${Math.round(weather.apparentTemperatureC)}°C`);
  }
  if (Number.isFinite(weather.windKph)) {
    parts.push(`Wind ${Math.round(weather.windKph)} km/h`);
  }
  if (weather.observedAt) {
    parts.push(`Updated ${formatTimeHm(weather.observedAt)}`);
  }
  return parts.join(' · ') || 'Live conditions for central London.';
}
