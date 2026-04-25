import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeWeatherCode,
  formatLondonWeatherMeta,
  normaliseLondonWeatherPayload
} from '../app/weather/index.mjs';

test('describeWeatherCode maps clear daytime weather', () => {
  assert.deepEqual(describeWeatherCode(0, true), {
    label: 'Clear',
    icon: '☀️'
  });
});

test('normaliseLondonWeatherPayload extracts current conditions', () => {
  const weather = normaliseLondonWeatherPayload({
    current: {
      temperature_2m: 11.8,
      apparent_temperature: 9.9,
      wind_speed_10m: 13.1,
      weather_code: 3,
      is_day: 1,
      time: '2026-04-25T18:05'
    }
  });

  assert.equal(weather.status, 'success');
  assert.equal(weather.temperatureC, 11.8);
  assert.equal(weather.apparentTemperatureC, 9.9);
  assert.equal(weather.windKph, 13.1);
  assert.equal(weather.conditionLabel, 'Overcast');
  assert.equal(weather.conditionIcon, '☁️');
});

test('formatLondonWeatherMeta formats current weather details', () => {
  assert.match(formatLondonWeatherMeta({
    status: 'success',
    apparentTemperatureC: 10.2,
    windKph: 15.4,
    observedAt: '2026-04-25T18:05:00.000Z'
  }), /^Feels like 10°C · Wind 15 km\/h · Updated /);
});
