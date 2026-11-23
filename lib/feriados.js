// Feriados brasileiros calculados (nunca guardados no cofre).
// tipo: 'nacional' (vermelho), 'facultativo' (ponto facultativo), 'comemorativa' (só lembrete).
import { toISO, addDays } from './dates.js';

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// n-ésimo dia da semana do mês (weekday 0 = domingo; month 0 = janeiro).
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + 7 * (n - 1));
}

const cache = new Map();

export function holidaysOf(year) {
  if (cache.has(year)) return cache.get(year);
  const e = easter(year);
  const fixed = (m, d) => toISO(new Date(year, m - 1, d));
  const list = [
    { date: fixed(1, 1), name: 'Confraternização Universal', type: 'nacional' },
    { date: toISO(addDays(e, -48)), name: 'Carnaval', type: 'facultativo' },
    { date: toISO(addDays(e, -47)), name: 'Carnaval', type: 'facultativo' },
    { date: toISO(addDays(e, -46)), name: 'Quarta-feira de Cinzas', type: 'facultativo' },
    { date: toISO(addDays(e, -2)), name: 'Sexta-feira Santa', type: 'nacional' },
    { date: toISO(e), name: 'Páscoa', type: 'comemorativa' },
    { date: fixed(4, 21), name: 'Tiradentes', type: 'nacional' },
    { date: fixed(5, 1), name: 'Dia do Trabalho', type: 'nacional' },
    { date: toISO(nthWeekday(year, 4, 0, 2)), name: 'Dia das Mães', type: 'comemorativa' },
    { date: toISO(addDays(e, 60)), name: 'Corpus Christi', type: 'facultativo' },
    { date: toISO(nthWeekday(year, 7, 0, 2)), name: 'Dia dos Pais', type: 'comemorativa' },
    { date: fixed(9, 7), name: 'Independência do Brasil', type: 'nacional' },
    { date: fixed(10, 12), name: 'Nossa Senhora Aparecida', type: 'nacional' },
    { date: fixed(11, 2), name: 'Finados', type: 'nacional' },
    { date: fixed(11, 15), name: 'Proclamação da República', type: 'nacional' },
    { date: fixed(12, 25), name: 'Natal', type: 'nacional' },
  ];
  if (year >= 2024) list.push({ date: fixed(11, 20), name: 'Consciência Negra', type: 'nacional' }); // Lei 14.759/2023
  list.sort((x, y) => x.date.localeCompare(y.date));
  cache.set(year, list);
  return list;
}

// Feriados de uma data (ISO). Nacional primeiro.
export function holidaysOn(iso) {
  const year = Number(iso.slice(0, 4));
  const order = { nacional: 0, facultativo: 1, comemorativa: 2 };
  return holidaysOf(year).filter((h) => h.date === iso).sort((a, b) => order[a.type] - order[b.type]);
}

export function isNationalHoliday(iso) {
  return holidaysOn(iso).some((h) => h.type === 'nacional');
}

// Próximo feriado a partir de uma data (inclusive), dos tipos pedidos.
export function nextHoliday(fromIso, types = ['nacional', 'facultativo']) {
  const year = Number(fromIso.slice(0, 4));
  for (const y of [year, year + 1]) {
    const hit = holidaysOf(y).find((h) => h.date >= fromIso && types.includes(h.type));
    if (hit) return hit;
  }
  return null;
}
