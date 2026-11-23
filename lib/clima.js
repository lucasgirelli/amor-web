// Tempo do dia para a aba Hoje (Open-Meteo: grátis, sem chave). Cidade vem do config (weatherCity).
// Busca no máximo a cada 30 min (ao desenhar a aba), guarda a última resposta para mostrar sem rede.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const MAX_AGE = 30 * 60 * 1000;
const CACHE_KEY = 'amor-clima';

// Códigos WMO -> texto e emoji (noite troca o sol pela lua).
const WMO = {
  0: ['Céu limpo', '☀️', '🌙'],
  1: ['Quase limpo', '🌤️', '🌙'],
  2: ['Parcialmente nublado', '⛅', '☁️'],
  3: ['Nublado', '☁️', '☁️'],
  45: ['Neblina', '🌫️'], 48: ['Neblina', '🌫️'],
  51: ['Garoa fraca', '🌦️'], 53: ['Garoa', '🌦️'], 55: ['Garoa forte', '🌧️'],
  56: ['Garoa gelada', '🌧️'], 57: ['Garoa gelada', '🌧️'],
  61: ['Chuva fraca', '🌦️'], 63: ['Chuva', '🌧️'], 65: ['Chuva forte', '🌧️'],
  66: ['Chuva gelada', '🌧️'], 67: ['Chuva gelada', '🌧️'],
  71: ['Neve fraca', '🌨️'], 73: ['Neve', '🌨️'], 75: ['Neve forte', '🌨️'], 77: ['Neve', '🌨️'],
  80: ['Pancadas de chuva', '🌦️'], 81: ['Pancadas de chuva', '🌧️'], 82: ['Pancadas fortes', '⛈️'],
  85: ['Pancadas de neve', '🌨️'], 86: ['Pancadas de neve', '🌨️'],
  95: ['Trovoada', '⛈️'], 96: ['Trovoada com granizo', '⛈️'], 99: ['Trovoada com granizo', '⛈️'],
};

export function describe(code, isDay = true) {
  const w = WMO[code] || ['Tempo indefinido', '🌡️'];
  return { text: w[0], emoji: !isDay && w[2] ? w[2] : w[1] };
}

export function validCity(c) {
  return !!c && typeof c === 'object' && typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 80
    && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;
}

const cityKey = (c) => `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
let memo = null; // { key, at, data }
let inflight = null;

function readCache() {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch { memo = null; }
  return memo;
}
function writeCache(entry) {
  memo = entry;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* sem localStorage */ }
}

// Último tempo conhecido da cidade (pode estar velho) ou null.
export function cached(city) {
  const c = readCache();
  return c && validCity(city) && c.key === cityKey(city) ? c : null;
}

export function isStale(city) {
  const c = cached(city);
  return !c || Date.now() - c.at > MAX_AGE;
}

// Busca o tempo de hoje. Devolve { key, at, data } (data já resumido para a aba).
export function refresh(city) {
  if (!validCity(city)) return Promise.reject(new Error('Cidade inválida.'));
  if (inflight) return inflight;
  const q = new URLSearchParams({
    latitude: String(city.lat), longitude: String(city.lon), timezone: 'auto', forecast_days: '2',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset',
  });
  inflight = fetch(`${FORECAST}?${q}`, { cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}.`); return res.json(); })
    .then((j) => {
      const entry = { key: cityKey(city), at: Date.now(), data: summarize(j) };
      writeCache(entry);
      return entry;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Hora local da cidade: a API manda "2026-11-23T14:00" já no fuso dela.
const hourOf = (iso) => Number(iso.slice(11, 13));

function summarize(j) {
  const c = j.current;
  const d = j.daily;
  const today = d.time[0];
  const nowIso = c.time; // "2026-11-23T14:15"
  const nowHour = `${nowIso.slice(0, 13)}:00`;
  // Próximas horas, de 3 em 3, a partir da próxima hora cheia (até 8 pontos). tomorrow = primeira hora de amanhã.
  const hours = [];
  const start = j.hourly.time.findIndex((t) => t > nowHour);
  for (let i = start; i >= 0 && i < j.hourly.time.length && hours.length < 8; i += 3) {
    hours.push({
      hour: hourOf(j.hourly.time[i]),
      tomorrow: j.hourly.time[i].slice(0, 10) !== today && !hours.some((x) => x.tomorrow),
      temp: Math.round(j.hourly.temperature_2m[i]),
      rain: j.hourly.precipitation_probability[i],
      ...describe(j.hourly.weather_code[i], j.hourly.is_day[i] === 1),
    });
  }
  return {
    now: {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      wind: Math.round(c.wind_speed_10m),
      ...describe(c.weather_code, c.is_day === 1),
    },
    day: {
      date: today,
      max: Math.round(d.temperature_2m_max[0]),
      min: Math.round(d.temperature_2m_min[0]),
      rain: d.precipitation_probability_max[0],
      rainMm: d.precipitation_sum[0],
      uv: Math.round(d.uv_index_max[0]),
      sunrise: d.sunrise[0].slice(11, 16),
      sunset: d.sunset[0].slice(11, 16),
      ...describe(d.weather_code[0], true),
    },
    hours,
  };
}

// Procura cidades pelo nome (para trocar a cidade do tempo).
export async function searchCity(name) {
  const q = new URLSearchParams({ name: String(name).trim(), count: '6', language: 'pt', format: 'json' });
  const res = await fetch(`${GEOCODE}?${q}`);
  if (!res.ok) throw new Error(`Busca de cidade respondeu ${res.status}.`);
  const j = await res.json();
  return (j.results || []).map((r) => ({
    name: r.name,
    admin: [r.admin1, r.country_code === 'BR' ? null : r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
