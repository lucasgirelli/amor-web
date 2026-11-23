// Aba Tarefas: kanban sobre Organizador/Tarefas.md. Arrastar entre colunas, criar, editar e concluir pelo círculo.
import { h } from '../../lib/dom.js';
import {
  organizer, COLUMNS, CATEGORIES, categoryLabel, parseTaskText, starredOn, MAX_STARS, dueLabel, TASKS_FILE,
} from '../../lib/organizador.js';

const BOARD = ['para-fazer', 'fazendo', 'em-espera'];
const DONE_PREVIEW = 6;

let ctx = null;

const todayIso = () => ctx.api.dates.toISO(ctx.api.dates.today());
const colTitle = (id) => COLUMNS.find((c) => c.id === id).title;
const fmtDay = (iso) => {
  const d = ctx.api.dates.fromISO(iso);
  return d ? `${d.getDate()} ${ctx.api.dates.MONTHS_SHORT[d.getMonth()]}` : iso;
};

async function run(action, okMsg) {
  try {
    await action();
    if (okMsg) ctx.api.ui.toast(okMsg, { type: 'ok' });
    return true;
  } catch (err) {
    ctx.api.ui.toast(err.message, { type: 'error' });
    ctx.org.reload();
    return false;
  }
}

// Card -------------------------------------------------------------------------------------------
function chips(task) {
  const out = [];
  const today = todayIso();
  if (task.star === today) out.push(h('span', { class: 'tk-chip tk-star', title: 'Prioridade de hoje', text: '★ hoje' }));
  const due = dueLabel(task.due, today);
  if (due && !task.done) out.push(h('span', { class: `tk-chip tk-due is-${due.tone}`, title: `Prazo: ${fmtDay(task.due)}`, text: due.text }));
  if (task.prio === 'alta') out.push(h('span', { class: 'tk-chip tk-prio is-alta', title: 'Prioridade alta', text: '↑ alta' }));
  if (task.prio === 'baixa') out.push(h('span', { class: 'tk-chip tk-prio is-baixa', title: 'Prioridade baixa', text: '↓ baixa' }));
  if (task.subtasks.length) {
    const done = task.subtasks.filter((s) => s.done).length;
    out.push(h('span', { class: 'tk-chip', title: 'Subtarefas', text: `☑ ${done}/${task.subtasks.length}` }));
  }
  if (task.category) out.push(h('span', { class: 'tk-chip tk-cat', text: categoryLabel(task.category) }));
  return out;
}

function card(task) {
  const el = h('article', {
    class: 'tk-card', draggable: 'true', tabindex: '0', 'aria-label': task.title,
    onClick: () => openEditor(task),
    onKeydown: (e) => { if (e.key === 'Enter') openEditor(task); },
    onDragstart: (e) => {
      ctx.drag = task;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', task.key);
      requestAnimationFrame(() => el.classList.add('is-dragging'));
    },
    onDragend: () => { ctx.drag = null; clearDropMarkers(); el.classList.remove('is-dragging'); },
  },
  h('button', {
    class: 'tk-check', type: 'button', title: 'Concluir', 'aria-label': `Concluir ${task.title}`,
    onClick: (e) => { e.stopPropagation(); run(() => ctx.org.toggleTask(task)); },
  }),
  h('div', { class: 'tk-main' },
    h('span', { class: 'tk-title', text: task.title }),
    h('div', { class: 'tk-meta' }, chips(task))));
  if (task.category) el.style.setProperty('--cat', `var(--cat-${task.category})`);
  return el;
}

// Arrastar --------------------------------------------------------------------------------------
function clearDropMarkers() {
  for (const m of ctx.el.querySelectorAll('.tk-drop')) m.remove();
  for (const c of ctx.el.querySelectorAll('.is-over')) c.classList.remove('is-over');
}

function dropIndex(list, y) {
  const cards = [...list.querySelectorAll('.tk-card:not(.is-dragging)')];
  const i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { index: i < 0 ? cards.length : i, before: i < 0 ? null : cards[i] };
}

function makeDropZone(zone, list, column) {
  zone.addEventListener('dragover', (e) => {
    if (!ctx.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    zone.classList.add('is-over');
    if (list) {
      const { before } = dropIndex(list, e.clientY);
      const marker = h('div', { class: 'tk-drop' });
      if (before) list.insertBefore(marker, before);
      else list.append(marker);
    }
  });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) clearDropMarkers(); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    const task = ctx.drag;
    const index = list ? dropIndex(list, e.clientY).index : 0;
    clearDropMarkers();
    ctx.drag = null;
    if (!task) return;
    if (task.column === column) {
      const same = ctx.org.tasks.filter((t) => t.column === column);
      if (same.indexOf(task) === index) return;
    }
    run(() => ctx.org.moveTask(task, column, index));
  });
}

// Quadro ----------------------------------------------------------------------------------------
function quickAdd() {
  const input = h('input', {
    class: 'input', type: 'text', 'aria-label': 'Nova tarefa',
    placeholder: 'Nova tarefa… (aceita 📅 2026-11-20, ⏫, #categoria)',
  });
  const add = async () => {
    const raw = input.value.trim();
    if (!raw) { input.focus(); return; }
    const p = parseTaskText(raw);
    if (!p.title) { ctx.api.ui.toast('Escreva o título da tarefa.', { type: 'error' }); return; }
    const ok = await run(() => ctx.org.addTask({ title: p.title, due: p.due, prio: p.prio, star: p.star, category: p.category, tags: p.tags }, 'para-fazer'));
    if (ok) { input.value = ''; input.focus(); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('div', { class: 'tk-quick' }, input,
    h('button', { class: 'btn btn-primary', type: 'button', onClick: add, text: 'Adicionar' }),
    h('button', { class: 'btn', type: 'button', onClick: () => openEditor(null), text: 'Com detalhes' }));
}

function column(colId) {
  const tasks = ctx.org.tasks.filter((t) => t.column === colId);
  const list = h('div', { class: 'tk-list' }, tasks.length ? tasks.map(card) : h('p', { class: 'tk-empty', text: 'Arraste uma tarefa para cá' }));
  const col = h('section', { class: 'tk-col', dataset: { col: colId } },
    h('header', { class: 'tk-col-head' }, h('span', { text: colTitle(colId) }), h('span', { class: 'tk-count', text: String(tasks.length) })),
    list);
  makeDropZone(col, list, colId);
  return col;
}

function doneSection() {
  const all = ctx.org.tasks.filter((t) => t.column === 'feito');
  const shown = ctx.showAllDone ? all : all.slice(0, DONE_PREVIEW);
  const sec = h('section', { class: 'tk-done' },
    h('header', { class: 'tk-col-head' },
      h('span', { text: 'Feito' }), h('span', { class: 'tk-count', text: String(all.length) }),
      all.length > DONE_PREVIEW
        ? h('button', { class: 'btn btn-ghost tk-more', type: 'button', text: ctx.showAllDone ? 'Mostrar menos' : 'Mostrar todas', onClick: () => { ctx.showAllDone = !ctx.showAllDone; render(); } })
        : null),
    shown.length
      ? h('ul', { class: 'tk-done-list' }, shown.map((t) => h('li', { class: 'tk-done-row', onClick: () => openEditor(t) },
        h('button', {
          class: 'tk-check is-done', type: 'button', title: 'Reabrir', 'aria-label': `Reabrir ${t.title}`,
          onClick: (e) => { e.stopPropagation(); run(() => ctx.org.toggleTask(t)); },
        }),
        h('span', { class: 'tk-title', text: t.title }),
        t.doneDate ? h('span', { class: 'small muted', text: fmtDay(t.doneDate) }) : null)))
      : h('p', { class: 'tk-empty', text: 'Arraste para cá o que terminou' }));
  makeDropZone(sec, null, 'feito');
  return sec;
}

function renderBoard() {
  const open = ctx.org.tasks.filter((t) => !t.done).length;
  ctx.el.replaceChildren(
    h('header', { class: 'tk-head' },
      h('h1', { class: 'display', text: 'Tarefas' }),
      h('span', { class: 'small muted', text: `${open} ${open === 1 ? 'aberta' : 'abertas'} · ${TASKS_FILE}` })),
    quickAdd(),
    h('div', { class: 'tk-board' }, BOARD.map(column)),
    doneSection(),
  );
}

// Editor ----------------------------------------------------------------------------------------
function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { text: label }), control, hint ? h('small', { class: 'muted', text: hint }) : null);
}

function select(options, value) {
  return h('select', { class: 'input' }, options.map(([v, label]) => h('option', { value: v, selected: v === value ? true : null, text: label })));
}

function openEditor(task) {
  ctx.view = 'edit';
  ctx.editing = task;
  render();
}

function closeEditor() {
  ctx.view = 'board';
  ctx.editing = null;
  render();
}

function renderEditor() {
  const task = ctx.editing;
  const today = todayIso();
  const title = h('input', { class: 'input', type: 'text', value: task ? task.title : '', placeholder: 'O que precisa ser feito?' });
  const col = select(COLUMNS.map((c) => [c.id, c.title]), task ? task.column : 'para-fazer');
  const due = h('input', { class: 'input', type: 'date', value: task && task.due ? task.due : '' });
  const cat = select([['', 'Sem categoria'], ...CATEGORIES.map((c) => [c.id, c.label])], task && task.category ? task.category : '');

  let prio = task ? task.prio : 'media';
  const prioBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Prioridade' });
  const drawPrio = () => prioBox.replaceChildren(...[['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']].map(([v, label]) => h('button', {
    class: `seg-btn${prio === v ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(prio === v), text: label,
    onClick: () => { prio = v; drawPrio(); },
  })));
  drawPrio();

  const starCb = h('input', { type: 'checkbox', checked: task && task.star === today ? true : null });
  const star = h('label', { class: 'switch' }, starCb, h('span', { class: 'track' }), h('span', { text: '★ Prioridade de hoje (até 3 por dia)' }));

  const subs = task ? task.subtasks.map((s) => ({ ...s })) : [];
  const subList = h('div', { class: 'tk-subs' });
  const drawSubs = () => subList.replaceChildren(...subs.map((s, i) => h('div', { class: 'tk-sub' },
    h('input', { type: 'checkbox', checked: s.done ? true : null, 'aria-label': 'Feita', onChange: (e) => { s.done = e.target.checked; } }),
    h('input', { class: 'input', type: 'text', value: s.text, placeholder: 'Subtarefa', onInput: (e) => { s.text = e.target.value; } }),
    h('button', { class: 'icon-btn', type: 'button', title: 'Tirar', 'aria-label': 'Tirar subtarefa', text: '×', onClick: () => { subs.splice(i, 1); drawSubs(); } }))));
  drawSubs();
  const addSub = h('button', {
    class: 'btn btn-ghost', type: 'button', text: '+ Subtarefa',
    onClick: () => { subs.push({ done: false, text: '' }); drawSubs(); subList.querySelector('.tk-sub:last-child .input').focus(); },
  });
  const notes = h('textarea', { class: 'input tk-notes', rows: '3', placeholder: 'Uma observação por linha' });
  notes.value = task ? task.notes.join('\n') : '';

  const save = async () => {
    const t = title.value.trim();
    if (!t) { ctx.api.ui.toast('Escreva o título da tarefa.', { type: 'error' }); title.focus(); return; }
    const wantStar = starCb.checked;
    if (wantStar && !(task && task.star === today) && starredOn(ctx.org.tasks, today).length >= MAX_STARS) {
      ctx.api.ui.toast(`Já há ${MAX_STARS} prioridades hoje. Tire uma antes.`, { type: 'error' });
      return;
    }
    const column = col.value;
    const data = {
      title: t,
      due: due.value || null,
      prio,
      star: wantStar ? today : null,
      category: cat.value || null,
      tags: task ? task.tags : [],
      subtasks: subs.filter((s) => s.text.trim()),
      notes: notes.value.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    const ok = await run(() => (task
      ? ctx.org.saveTask(task, data, column)
      : ctx.org.addTask({ ...data, doneDate: column === 'feito' ? today : null }, column, column === 'feito' ? 0 : Infinity)),
    task ? 'Tarefa salva.' : 'Tarefa criada.');
    if (ok) closeEditor();
  };

  const remove = async () => {
    const yes = await ctx.api.ui.confirm({
      title: 'Apagar esta tarefa?', message: `"${task.title}" sai do Tarefas.md, junto com as subtarefas.`, confirmLabel: 'Apagar', danger: true,
    });
    if (yes && await run(() => ctx.org.removeTask(task), 'Tarefa apagada.')) closeEditor();
  };

  ctx.el.replaceChildren(h('form', { class: 'tk-editor card', onSubmit: (e) => { e.preventDefault(); save(); } },
    h('header', { class: 'tk-editor-head' }, h('h1', { class: 'display', text: task ? 'Editar tarefa' : 'Nova tarefa' })),
    field('Título', title),
    h('div', { class: 'tk-row' }, field('Coluna', col), field('Prazo', due), field('Categoria', cat)),
    field('Prioridade', prioBox),
    star,
    h('div', { class: 'field' }, h('span', { text: 'Subtarefas' }), subList, addSub),
    field('Observações', notes),
    h('footer', { class: 'tk-editor-foot' },
      task ? h('button', { class: 'btn btn-danger', type: 'button', text: 'Apagar', onClick: remove }) : h('span'),
      h('div', { class: 'tk-editor-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancelar', onClick: closeEditor }),
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'Salvar' })))));
  title.focus();
}

function render() {
  if (!ctx) return;
  if (ctx.view === 'edit') renderEditor();
  else renderBoard();
}

export default {
  id: 'tarefas',
  title: 'Tarefas',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="7" rx="1.5"/></svg>',

  async mount(el, api) {
    const org = organizer(api);
    ctx = { api, el, org, view: 'board', editing: null, drag: null, showAllDone: false, offs: [] };
    el.replaceChildren(h('p', { class: 'muted', text: 'Lendo as tarefas…' }));
    await org.ready();
    ctx.offs.push(org.subscribe(() => { if (ctx && ctx.view === 'board') render(); }));
    ctx.offs.push(api.dates.onDayChange(() => { if (ctx && ctx.view === 'board') render(); }));
    render();
  },

  unmount() {
    if (!ctx) return;
    for (const off of ctx.offs) off();
    ctx = null;
  },
};
