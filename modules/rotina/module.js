// Aba Rotina: tabela do que se repete toda semana (aulas, estágio…), fora do calendário da Agenda.
// Lê os mesmos eventos de Organizador/Agenda/ (repete: semanal, dias_uteis ou diario).
import { h } from '../../lib/dom.js';
import { organizer, categoryLabel, routineWeekdays } from '../../lib/organizador.js';
import { REPETE_LABEL } from '../../lib/recorrencia.js';
import { eventEditor } from '../../lib/evento-editor.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda primeiro, como grade de aulas
const DAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

let ctx = null;

const D = () => ctx.api.dates;
const catVar = (el, cat) => { if (cat) el.style.setProperty('--cat', `var(--cat-${cat})`); return el; };
const fmtDay = (iso) => { const d = D().fromISO(iso); return `${d.getDate()} ${D().MONTHS_SHORT[d.getMonth()]}`; };
const slotOf = (ev) => (ev.dia_todo ? 'dia todo' : `${ev.inicio}${ev.fim ? `–${ev.fim}` : ''}`);
const bySlot = (a, b) => (a === b ? 0 : a === 'dia todo' ? -1 : b === 'dia todo' ? 1 : a.localeCompare(b));

function when(ev) {
  if (ev.repete === 'semanal') return `toda ${DAY_NAME[D().fromISO(ev.data).getDay()]}`;
  return REPETE_LABEL[ev.repete].toLowerCase();
}

function period(ev, todayIso) {
  const from = ev.data > todayIso ? `começa ${fmtDay(ev.data)}` : `desde ${fmtDay(ev.data)}`;
  return ev.ate ? `${from} até ${fmtDay(ev.ate)}` : `${from}, sem fim`;
}

function openEditor(ev) {
  ctx.editing = { ev };
  render();
}

// Tabela --------------------------------------------------------------------------------------
function table(active, todayIso) {
  const todayDow = D().fromISO(todayIso).getDay();
  // Seg a sex sempre; sábado e domingo só se houver algo neles.
  const days = DAY_ORDER.filter((dow) => (dow >= 1 && dow <= 5) || active.some((ev) => routineWeekdays(ev).includes(dow)));
  const slots = [...new Set(active.map(slotOf))].sort(bySlot);

  const grid = h('div', { class: 'rt-table', role: 'table', 'aria-label': 'Rotina da semana' });
  grid.style.gridTemplateColumns = `70px repeat(${days.length}, minmax(0, 1fr))`;
  grid.append(h('span', { class: 'rt-corner', role: 'columnheader' }));
  for (const dow of days) {
    grid.append(h('span', { class: `rt-day${dow === todayDow ? ' is-today' : ''}${dow === 0 ? ' is-red' : ''}`, role: 'columnheader', text: D().WEEKDAYS_SHORT[dow] }));
  }
  for (const slot of slots) {
    grid.append(h('span', { class: `rt-slot mono${slot === 'dia todo' ? ' is-allday' : ''}`, role: 'rowheader', text: slot }));
    for (const dow of days) {
      const items = active.filter((ev) => slotOf(ev) === slot && routineWeekdays(ev).includes(dow));
      grid.append(h('div', { class: `rt-cell${dow === todayDow ? ' is-today' : ''}`, role: 'cell' },
        items.map((ev) => catVar(h('button', {
          class: `rt-item${ev.data > todayIso ? ' is-future' : ''}`, type: 'button',
          title: `${ev.titulo} · ${slot} · ${period(ev, todayIso)}`, onClick: () => openEditor(ev),
        }, h('span', { class: 'rt-item-title', text: ev.titulo }), ev.local ? h('span', { class: 'rt-item-sub', text: ev.local }) : null), ev.categoria))));
    }
  }
  return h('section', { class: 'card rt-card' }, grid);
}

// Detalhes ------------------------------------------------------------------------------------
function details(list, todayIso, titleText, extraClass = '') {
  return h('section', { class: `card ${extraClass}`.trim() },
    h('h2', { class: 'card-title', text: titleText }),
    h('ul', { class: 'rt-list' }, list.map((ev) => h('li', {},
      catVar(h('button', { class: 'rt-row', type: 'button', onClick: () => openEditor(ev) },
        h('span', { class: 'rt-row-main' },
          h('span', { class: 'rt-row-title', text: ev.titulo }),
          h('span', { class: 'small muted', text: [when(ev), slotOf(ev), period(ev, todayIso), ev.pular_feriados ? 'pula feriados' : null].filter(Boolean).join(' · ') }),
          ev.obs ? h('span', { class: 'small rt-row-obs', text: ev.obs }) : null),
        ev.categoria ? h('span', { class: 'rt-cat', text: categoryLabel(ev.categoria) }) : null), ev.categoria)))));
}

function render() {
  if (!ctx) return;
  if (ctx.editing) {
    ctx.el.replaceChildren(eventEditor({
      api: ctx.api, org: ctx.org, ev: ctx.editing.ev, date: D().toISO(D().today()), repete: 'semanal',
      onDone: () => { ctx.editing = null; render(); },
    }));
    return;
  }
  const todayIso = D().toISO(D().today());
  // Ordem da semana (segunda primeiro), depois horário.
  const dayRank = (ev) => Math.min(...routineWeekdays(ev).map((dow) => DAY_ORDER.indexOf(dow)), 99);
  const all = [...ctx.org.routine].sort((a, b) => dayRank(a) - dayRank(b) || bySlot(slotOf(a), slotOf(b)) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
  const active = all.filter((ev) => !ev.ate || ev.ate >= todayIso);
  const ended = all.filter((ev) => ev.ate && ev.ate < todayIso);

  ctx.el.replaceChildren(
    h('header', { class: 'rt-head' },
      h('div', {},
        h('h1', { class: 'display', text: 'Rotina' }),
        h('span', { class: 'small muted', text: 'O que se repete toda semana. Fica fora do calendário da Agenda.' })),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Nova atividade', onClick: () => openEditor(null) })),
    active.length
      ? table(active, todayIso)
      : h('div', { class: 'empty' }, h('strong', { text: 'Nenhuma atividade semanal' }), h('span', { text: 'Crie uma com "Nova atividade" (aula, treino, estágio…).' })),
    active.length ? details(active, todayIso, 'Detalhes') : null,
    ended.length ? details(ended, todayIso, `Encerradas · ${ended.length}`, 'rt-ended') : null,
  );
}

export default {
  id: 'rotina',
  title: 'Rotina',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16M3 14.5h18"/></svg>',

  async mount(el, api) {
    const org = organizer(api);
    ctx = { api, el, org, editing: null, offs: [] };
    el.replaceChildren(h('p', { class: 'muted', text: 'Lendo a rotina…' }));
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
