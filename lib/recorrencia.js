// Ocorrências de um evento num intervalo de datas (ISO, inclusivo).
// repete: nao | diario | dias_uteis | semanal | mensal | anual; ate = última data (vazio = sem fim);
// pular_feriados = pula os feriados nacionais.
import { fromISO, toISO, addDays } from './dates.js';
import { isNationalHoliday } from './feriados.js';

export const REPETE = ['nao', 'diario', 'dias_uteis', 'semanal', 'mensal', 'anual'];
export const REPETE_LABEL = {
  nao: 'Não repete',
  diario: 'Todo dia',
  dias_uteis: 'Dias úteis (seg a sex)',
  semanal: 'Toda semana',
  mensal: 'Todo mês',
  anual: 'Todo ano',
};

const MAX = 1000; // proteção contra intervalos enormes

export function occurrences(ev, fromIso, toIso) {
  if (!ev || !ev.data || !fromISO(ev.data)) return [];
  const repete = REPETE.includes(ev.repete) ? ev.repete : 'nao';
  const last = ev.ate && fromISO(ev.ate) && ev.ate < toIso ? ev.ate : toIso;
  if (repete === 'nao') return ev.data >= fromIso && ev.data <= toIso ? [ev.data] : [];
  if (last < fromIso || ev.data > last) return [];

  const start = fromISO(ev.data);
  const out = [];
  const push = (d) => {
    const iso = toISO(d);
    if (iso >= fromIso && iso <= last && !(ev.pular_feriados && isNationalHoliday(iso))) out.push(iso);
  };

  if (repete === 'diario' || repete === 'dias_uteis') {
    let d = ev.data < fromIso ? fromISO(fromIso) : start;
    for (let i = 0; i < MAX && toISO(d) <= last; i++, d = addDays(d, 1)) {
      if (repete === 'dias_uteis' && (d.getDay() === 0 || d.getDay() === 6)) continue;
      push(d);
    }
  } else if (repete === 'semanal') {
    let d = start;
    if (ev.data < fromIso) {
      const diff = Math.round((fromISO(fromIso) - start) / 86400000);
      d = addDays(start, Math.ceil(diff / 7) * 7);
    }
    for (let i = 0; i < MAX && toISO(d) <= last; i++, d = addDays(d, 7)) push(d);
  } else if (repete === 'mensal') {
    const day = start.getDate();
    for (let i = 0; i < MAX; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, day);
      if (d.getDate() !== day) continue; // mês sem esse dia (ex.: 31)
      if (toISO(d) > last) break;
      push(d);
    }
  } else if (repete === 'anual') {
    for (let i = 0; i < 200; i++) {
      const d = new Date(start.getFullYear() + i, start.getMonth(), start.getDate());
      if (d.getMonth() !== start.getMonth()) continue; // 29/2 fora de ano bissexto
      if (toISO(d) > last) break;
      push(d);
    }
  }
  return out;
}
