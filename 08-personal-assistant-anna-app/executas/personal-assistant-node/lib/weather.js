const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

const WEATHER_LABELS = {
  0: "晴朗",
  1: "大致晴朗",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "较强毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  80: "阵雨",
  81: "较强阵雨",
  82: "强阵雨",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴冰雹"
};

export async function getWeather({
  latitude,
  longitude,
  label = "当前位置",
  fetchImpl = globalThis.fetch,
  demo = false,
  timeoutMs = 10_000
}) {
  const coordinates = normalizeCoordinates(latitude, longitude);
  if (demo) return demoWeather({ ...coordinates, label });
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const forecast = new URL(FORECAST_URL);
  forecast.search = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m"
    ].join(","),
    timezone: "auto"
  });

  const air = new URL(AIR_URL);
  air.search = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    current: ["us_aqi", "pm2_5", "pm10"].join(","),
    timezone: "auto"
  });

  const [forecastResponse, airResponse] = await Promise.all([
    fetchWithTimeout(fetchImpl, forecast, timeoutMs),
    fetchWithTimeout(fetchImpl, air, timeoutMs)
  ]);
  if (!forecastResponse.ok) {
    throw new Error(`weather provider returned HTTP ${forecastResponse.status}`);
  }
  if (!airResponse.ok) {
    throw new Error(`air-quality provider returned HTTP ${airResponse.status}`);
  }

  const [forecastData, airData] = await Promise.all([
    forecastResponse.json(),
    airResponse.json()
  ]);
  return normalizeWeather({
    label,
    coordinates,
    forecast: forecastData,
    air: airData,
    source: "Open-Meteo"
  });
}

export function normalizeCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("latitude must be between -90 and 90");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("longitude must be between -180 and 180");
  }
  return {
    latitude: Math.round(lat * 1000) / 1000,
    longitude: Math.round(lon * 1000) / 1000
  };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("weather provider request timed out"));
    }, Math.max(1, Number(timeoutMs) || 10_000));
    timer.unref?.();
  });
  try {
    return await Promise.race([
      fetchImpl(url, { signal: controller.signal }),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeWeather({ label, coordinates, forecast, air, source }) {
  const current = forecast?.current || {};
  const airCurrent = air?.current || {};
  const code = Number(current.weather_code);
  return {
    location: {
      label: String(label || "当前位置").slice(0, 100),
      ...coordinates,
      timezone: forecast?.timezone || null
    },
    observed_at: current.time || airCurrent.time || new Date().toISOString(),
    weather: {
      code: Number.isFinite(code) ? code : null,
      label: WEATHER_LABELS[code] || "天气状态未知",
      temperature_c: finiteOrNull(current.temperature_2m),
      apparent_temperature_c: finiteOrNull(current.apparent_temperature),
      humidity_percent: finiteOrNull(current.relative_humidity_2m),
      wind_kmh: finiteOrNull(current.wind_speed_10m)
    },
    air: {
      us_aqi: finiteOrNull(airCurrent.us_aqi),
      pm2_5_ug_m3: finiteOrNull(airCurrent.pm2_5),
      pm10_ug_m3: finiteOrNull(airCurrent.pm10)
    },
    source,
    privacy: {
      transmitted: ["approximate_coordinates"],
      retained_by_app: false
    }
  };
}

function demoWeather({ latitude, longitude, label }) {
  return normalizeWeather({
    label,
    coordinates: { latitude, longitude },
    forecast: {
      timezone: "Asia/Shanghai",
      current: {
        time: "2026-06-14T09:00",
        temperature_2m: 24.6,
        apparent_temperature: 25.2,
        relative_humidity_2m: 67,
        weather_code: 2,
        wind_speed_10m: 10.4
      }
    },
    air: {
      current: {
        time: "2026-06-14T09:00",
        us_aqi: 46,
        pm2_5: 11.8,
        pm10: 24.2
      }
    },
    source: "Open-Meteo demo fixture"
  });
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
