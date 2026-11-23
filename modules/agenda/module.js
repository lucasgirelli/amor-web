// Aba Agenda: mês e semana, painel do dia, criar e editar evento (uma nota por evento em Organizador/Agenda/).
// Mostra só os compromissos avulsos; o que se repete toda semana fica na aba Rotina.
import { h } from '../../lib/dom.js';
import { organizer, categoryLabel, isRoutine } from '../../lib/organizador.js';
import { holidaysOn } from '../../lib/feriados.js';
import { REPETE_LABEL } from '../../lib/recorrencia.js';
import { eventEditor } from '../../lib/evento-editor.js';

const HOUR_FROM = 7;
const HOUR_TO = 24;
const HOUR_PX = 30;
const WEEK_HEAD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

let ctx = null;

const D = () => ctx.api.dates;
const iso = (d) => D().toISO(d);
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const isRed = (isoDate) => D().fromISO(isoDate).getDay() === 0 || holidaysOn(isoDate).some((x) => x.type === 'nacional');
const catVar = (el, cat) => { if (cat) el.style.setProperty('--cat', `var(--cat-${cat})`); return el; };

function timeLabel(o) {
  if (o.allDay) return 'dia todo';
  return o.ev.fim ? `${hhmm(o.start)}–${hhmm(o.end)}` : hhmm(o.start);
}

function byDate(occs) {
  const map = new Map();
  for (const o of occs) {
    if (!map.has(o.date)) map.set(o.date, []);
    map.get(o.date).push(o);
  }
  return map;
}

// Barra de ferramentas --------------------------------------------------------------------------
function title() {
  const { MONTHS, MONTHS_SHORT, startOfWeek, addDays } = D();
  if (ctx.view === 'mes') return `${MONTHS[ctx.cursor.getMonth()]} ${ctx.cursor.getFullYear()}`;
  const a = startOfWeek(ctx.cursor);
  const b = addDays(a, 6);
  const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  return `${left} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

function move(step) {
  const { addMonths, addDays } = D();
  ctx.cursor = ctx.view === 'mes' ? addMonths(ctx.cursor, step) : addDays(ctx.cursor, 7 * step);
  render();
}

function goToday() {
  const t = D().today();
  ctx.selected = iso(t);
  ctx.cursor = ctx.view === 'mes' ? new Date(t.getFullYear(), t.getMonth(), 1) : t;
  render();
}

function setView(v) {
  if (ctx.view === v) return;
  ctx.view = v;
  const sel = D().fromISO(ctx.selected);
  ctx.cursor = v === 'mes' ? new Date(sel.getFullYear(), sel.getMonth(), 1) : sel;
  render();
}

function toolbar() {
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Visão' },
    [['mes', 'Mês'], ['semana', 'Semana']].map(([v, label]) => h('button', {
      class: `seg-btn${ctx.view === v ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(ctx.view === v), text: label, onClick: () => setView(v),
    })));
  return h('header', { class: 'ag-bar' },
    h('div', { class: 'ag-nav' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Anterior', 'aria-label': 'Anterior', text: '‹', onClick: () => move(-1) }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Próximo', 'aria-label': 'Próximo', text: '›', onClick: () => move(1) }),
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Hoje', onClick: goToday })),
    h('h1', { class: 'display ag-title', text: title() }),
    seg,
    h('button', { class: 'btn btn-primary', type: 'button', text: 'Novo evento', onClick: () => openEditor(null, ctx.selected) }));
}

// Mês ---------------------------------------------------------------------------------------------
function monthView() {
  const { startOfWeek, addDays, today } = D();
  const first = ctx.cursor;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = startOfWeek(first);
  const end = addDays(start, weeks * 7 - 1);
  const map = byDate(ctx.org.appointments(iso(start), iso(end)));
  const todayIso = iso(today());

  const head = h('div', { class: 'ag-week-head' }, WEEK_HEAD.map((w, i) => h('span', { class: i === 0 ? 'is-red' : '', text: w })));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const di = iso(d);
    const occs = map.get(di) || [];
    const hol = holidaysOn(di)[0];
    const shown = occs.slice(0, 2);
    const cls = ['ag-cell'];
    if (d.getMonth() !== first.getMonth()) cls.push('is-out');
    if (di === todayIso) cls.push('is-today');
    if (di === ctx.selected) cls.push('is-selected');
    if (isRed(di)) cls.push('is-red');
    cells.push(h('button', {
      class: cls.join(' '), type: 'button', 'aria-label': `${d.getDate()}, ${occs.length} compromissos`,
      onClick: () => { ctx.selected = di; render(); },
      onDblclick: () => openEditor(null, di),
    },
    h('span', { class: 'ag-num num', text: String(d.getDate()) }),
    hol ? h('span', { class: `ag-hol is-${hol.type}`, title: hol.name, text: hol.name }) : null,
    shown.map((o) => catVar(h('span', { class: `ag-chip${o.allDay ? ' is-allday' : ''}`, title: `${timeLabel(o)} ${o.ev.titulo}`, text: o.allDay ? o.ev.titulo : `${hhmm(o.start)} ${o.ev.titulo}` }), o.ev.categoria)),
    occs.length > 2 ? h('span', { class: 'ag-more', text: `+${occs.length - 2}` }) : null));
  }
  return h('div', { class: 'ag-month' }, head, h('div', { class: 'ag-grid' }, cells));
}

// Semana ----------------------------------------------------------------------------------------
function lanes(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const ends = [];
  for (const o of sorted) {
    let lane = ends.findIndex((e) => e <= o.start);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = o.end;
    o.lane = lane;
  }
  for (const o of sorted) o.lanes = ends.length;
  return sorted;
}

function weekView() {
  const { startOfWeek, addDays, today, WEEKDAYS_SHORT } = D();
  const start = startOfWeek(ctx.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const map = byDate(ctx.org.appointments(iso(days[0]), iso(days[6])));
  const todayIso = iso(today());
  const height = (HOUR_TO - HOUR_FROM) * HOUR_PX;

  const head = h('div', { class: 'ag-wk-head' }, h('span'),
    days.map((d) => {
      const di = iso(d);
      return h('button', {
        class: `ag-wk-day${isRed(di) ? ' is-red' : ''}${di === todayIso ? ' is-today' : ''}${di === ctx.selected ? ' is-selected' : ''}`,
        type: 'button', onClick: () => { ctx.selected = di; render(); },
      }, h('span', { class: 'small', text: WEEKDAYS_SHORT[d.getDay()] }), h('span', { class: 'num', text: String(d.getDate()) }));
    }));

  const allDay = h('div', { class: 'ag-wk-allday' }, h('span', { class: 'small muted', text: 'dia' }),
    days.map((d) => {
      const di = iso(d);
      const hol = holidaysOn(di)[0];
      return h('div', { class: 'ag-wk-allday-cell' },
        hol ? h('span', { class: `ag-hol is-${hol.type}`, title: hol.name, text: hol.name }) : null,
        (map.get(di) || []).filter((o) => o.allDay).map((o) => catVar(h('button', {
          class: 'ag-chip is-allday', type: 'button', title: o.ev.titulo, text: o.ev.titulo, onClick: () => openEditor(o.ev, di),
        }), o.ev.categoria)));
    }));

  const hours = h('div', { class: 'ag-wk-hours' },
    Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => h('span', { class: 'mono', text: `${pad(HOUR_FROM + i)}:00` })));
  const cols = days.map((d) => {
    const di = iso(d);
    const col = h('div', {
      class: `ag-wk-col${di === todayIso ? ' is-today' : ''}`,
      onClick: (e) => {
        if (e.target !== col) return;
        const min = HOUR_FROM * 60 + Math.floor(((e.offsetY / HOUR_PX) * 60) / 30) * 30;
        openEditor(null, di, hhmm(Math.min(min, 23 * 60)));
      },
    });
    col.style.height = `${height}px`;
    for (const o of lanes((map.get(di) || []).filter((x) => !x.allDay))) {
      const top = Math.max(0, (o.start - HOUR_FROM * 60) / 60 * HOUR_PX);
      const bottom = Math.min(height, (o.end - HOUR_FROM * 60) / 60 * HOUR_PX);
      const block = catVar(h('button', {
        class: 'ag-wk-ev', type: 'button', title: `${timeLabel(o)} ${o.ev.titulo}`, onClick: () => openEditor(o.ev, di),
      }, h('span', { class: 'mono', text: hhmm(o.start) }), h('span', { class: 'ag-wk-ev-title', text: o.ev.titulo })), o.ev.categoria);
      block.style.top = `${top}px`;
      block.style.height = `${Math.max(18, bottom - top - 1)}px`;
      block.style.left = `${(o.lane / o.lanes) * 100}%`;
      block.style.width = `calc(${100 / o.lanes}% - 2px)`;
      col.append(block);
    }
    return col;
  });
  if (days.some((d) => iso(d) === todayIso)) {
    const nowMin = D().nowMinutes();
    if (nowMin >= HOUR_FROM * 60) {
      const line = h('div', { class: 'ag-now' });
      line.style.top = `${(nowMin - HOUR_FROM * 60) / 60 * HOUR_PX}px`;
      cols[days.findIndex((d) => iso(d) === todayIso)].append(line);
    }
  }
  const body = h('div', { class: 'ag-wk-body' }, hours, cols);
  return h('div', { class: 'ag-week' }, head, allDay, body);
}

// Painel do dia -----------------------------------------------------------------------------------
function dayPanel() {
  const { fromISO, formatLong, capitalize } = D();
  const di = ctx.selected;
  const occs = ctx.org.appointments(di, di);
  const hols = holidaysOn(di);
  return h('section', { class: 'card ag-day' },
    h('header', { class: 'ag-day-head' },
      h('h2', { class: `ag-day-title${isRed(di) ? ' is-red' : ''}`, text: capitalize(formatLong(fromISO(di))) }),
      h('button', { class: 'btn', type: 'button', text: '+ Evento neste dia', onClick: () => openEditor(null, di) })),
    hols.length ? h('p', { class: 'ag-day-hols' }, hols.map((x) => h('span', { class: `ag-hol is-${x.type}`, text: `${x.name}${x.type === 'facultativo' ? ' (ponto facultativo)' : ''}` }))) : null,
    occs.length
      ? h('ul', { class: 'ag-day-list' }, occs.map((o) => h('li', {},
        catVar(h('button', { class: 'ag-day-row', type: 'button', onClick: () => openEditor(o.ev, di) },
          h('span', { class: 'ag-day-time mono', text: timeLabel(o) }),
          h('span', { class: 'ag-day-main' },
            h('span', { class: 'ag-day-ev', text: o.ev.titulo }),
            h('span', { class: 'small muted', text: [categoryLabel(o.ev.categoria), o.ev.local, o.ev.repete !== 'nao' ? `↻ ${REPETE_LABEL[o.ev.repete].toLowerCase()}` : null].filter(Boolean).join(' · ') }))), o.ev.categoria))))
      : h('p', { class: 'muted', text: 'Nenhum compromisso. A rotina da semana fica na aba Rotina; dê dois cliques num dia para criar.' }));
}

// Editor ----------------------------------------------------------------------------------------
function openEditor(ev, date, startTime) {
  ctx.editing = { ev, date, startTime };
  render();
}

function renderEditor() {
  const { ev, date, startTime } = ctx.editing;
  ctx.el.replaceChildren(eventEditor({
    api: ctx.api, org: ctx.org, ev, date, startTime,
    onDone: (saved) => {
      if (saved && !isRoutine(saved)) {
        ctx.selected = saved.data;
        const d = D().fromISO(saved.data);
        ctx.cursor = ctx.view === 'mes' ? new Date(d.getFullYear(), d.getMonth(), 1) : d;
      }
      ctx.editing = null;
      render();
    },
  }));
}

// ----------------------------------------------------------------------------------------------
function render() {
  if (!ctx) return;
  if (ctx.editing) { renderEditor(); return; }
  ctx.el.replaceChildren(toolbar(), ctx.view === 'mes' ? monthView() : weekView(), dayPanel());
}

export default {
  id: 'agenda',
  title: 'Agenda',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 16.5h.01M12 16.5h.01"/></svg>',

  async mount(el, api) {
    const org = organizer(api);
    const t = api.dates.today();
    ctx = { api, el, org, view: 'mes', cursor: new Date(t.getFullYear(), t.getMonth(), 1), selected: api.dates.toISO(t), editing: null, offs: [] };
    el.replaceChildren(h('p', { class: 'muted', text: 'Lendo a agenda…' }));
    await org.ready();
    ctx.offs.push(org.subscribe(() => { if (ctx && !ctx.editing) render(); }));
    ctx.offs.push(api.dates.onDayChange(() => { if (ctx && !ctx.editing) render(); }));
    render();
  },

  unmount() {
    if (!ctx) return;
    for (const off of ctx.offs) off();
    ctx = null;
  },
};
