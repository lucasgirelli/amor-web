// Datas em pt-BR, sempre no fuso local. Datas "de calendário" usam Date à meia-noite local.

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return r;
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// Domingo da semana (calendário de parede começa no domingo).
export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

export function daysBetween(fromIso, toIso) {
  return Math.round((fromISO(toIso) - fromISO(fromIso)) / 86400000);
}

// "09:15" -> 555 (minutos desde a meia-noite); inválido -> null
export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1;
}

export function daysInYear(year) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

// Semana ISO 8601 (segunda a domingo; a semana 1 contém a primeira quinta-feira do ano).
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

export function isSunday(d) {
  return d.getDay() === 0;
}

// "domingo, 15 de novembro"
export function formatLong(d) {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

// "15 nov"
export function formatShort(d) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

// "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias", "15 nov"
export function formatRelative(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const d = new Date(ms);
  const days = Math.round((today() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return `há ${h} h`;
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return formatShort(d);
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function msUntilMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

// Avisa na virada do dia: um timer até a meia-noite (não é polling). O shell também chama
// refreshDay() quando o PC volta da suspensão.
const dayListeners = new Set();
let dayTimer = null;

function armDayTimer() {
  clearTimeout(dayTimer);
  dayTimer = setTimeout(() => { refreshDay(); }, msUntilMidnight() + 500);
}

export function refreshDay() {
  const d = today();
  for (const cb of dayListeners) {
    try { cb(d); } catch (err) { console.error('[dates] onDayChange:', err); }
  }
  armDayTimer();
}

export function onDayChange(cb) {
  dayListeners.add(cb);
  if (!dayTimer) armDayTimer();
  return () => dayListeners.delete(cb);
}
