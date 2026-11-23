// AMOR web: aba Anotador. Anotação rápida de tarefas e ideias, publicada no cofre para executar em casa.
// Tudo numa nota só (Organizador/Anotador.md), uma anotação por linha:
//   - [ ] 2026-11-23 18:40 · Tarefa · texto        ([x] = já feita em casa)
// Mexe só na linha da anotação; o resto da nota fica intacto.
import { h } from '../../lib/dom.js';

const FILE = 'Organizador/Anotador.md';
const TEMPLATE = '---\ntipo: anotador\n---\n# Anotador\n\nAnotações rápidas do AMOR web para executar em casa. Uma por linha; [x] = feita.\n\n';
const TYPES = ['Tarefa', 'Ideia'];
const LINE = /^- \[( |x)\] (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) · (Tarefa|Ideia) · (.*)$/;

let ctx = null;

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseNotes(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const m = raw.replace(/\r$/, '').match(LINE);
    if (m) out.push({ index: i, raw: raw.replace(/\r$/, ''), done: m[1] === 'x', date: m[2], time: m[3], type: m[4], text: m[5] });
  });
  return out;
}

// Acha a linha pelo conteúdo (a nota pode ter mudado em outro aparelho) e aplica fn(linha) -> linha | null (tira).
function changeLine(text, note, fn) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.replace(/\r$/, '') === note.raw);
  if (i < 0) throw new Error('Essa anotação mudou em outro aparelho. Confira a lista.');
  const next = fn(lines[i].replace(/\r$/, ''));
  if (next === null) lines.splice(i, 1); else lines[i] = next;
  return lines.join('\n');
}

async function run(fn, ok) {
  try {
    await fn();
    if (ok) ctx.api.ui.toast(ok, { type: 'ok' });
    return true;
  } catch (err) {
    ctx.api.ui.toast(err.message, { type: 'error' });
    return false;
  }
}

async function load() {
  try {
    ctx.notes = parseNotes((await ctx.api.vault.read(FILE)).text);
  } catch (err) {
    if (!/ENOENT|no such file/i.test(err.message)) ctx.api.ui.toast(err.message, { type: 'error' });
    ctx.notes = [];
  }
  render();
}

async function publish() {
  const text = ctx.input.value.replace(/\s*\n\s*/g, ' / ').trim();
  if (!text) { ctx.input.focus(); return; }
  ctx.publishBtn.disabled = true;
  const line = `- [ ] ${stamp()} · ${ctx.type} · ${text}`;
  const ok = await run(() => ctx.api.vault.patch(FILE, (t) => `${t.replace(/\s*$/, '')}\n${line}\n`, { createIfMissing: TEMPLATE }), 'Publicado. Fica no cofre para você fazer em casa.');
  ctx.publishBtn.disabled = false;
  if (ok) { ctx.input.value = ''; await load(); }
}

function toggle(note) {
  return run(() => ctx.api.vault.patch(FILE, (t) => changeLine(t, note, (l) => l.replace(/^- \[( |x)\]/, note.done ? '- [ ]' : '- [x]')))).then(load);
}

async function remove(note) {
  const yes = await ctx.api.ui.confirm({ title: 'Apagar esta anotação?', message: `"${note.text}" sai do ${FILE}.`, confirmLabel: 'Apagar', danger: true });
  if (yes) await run(() => ctx.api.vault.patch(FILE, (t) => changeLine(t, note, () => null)), 'Anotação apagada.').then(load);
}

async function clearDone() {
  const done = ctx.notes.filter((n) => n.done);
  const yes = await ctx.api.ui.confirm({ title: `Tirar ${done.length} feita(s)?`, message: `As anotações já feitas saem do ${FILE}. As que faltam ficam.`, confirmLabel: 'Tirar', danger: true });
  if (!yes) return;
  await run(() => ctx.api.vault.patch(FILE, (t) => t.split('\n').filter((l) => { const m = l.replace(/\r$/, '').match(LINE); return !(m && m[1] === 'x'); }).join('\n')), 'Feitas tiradas.');
  await load();
}

function row(note) {
  return h('li', { class: `an-item${note.done ? ' is-done' : ''}` },
    h('button', { class: 'an-check', type: 'button', 'aria-pressed': String(note.done), 'aria-label': note.done ? 'Marcar como não feita' : 'Marcar como feita', onClick: () => toggle(note) }),
    h('div', { class: 'an-main' },
      h('span', { class: 'an-text', text: note.text }),
      h('span', { class: 'an-meta small muted' },
        h('span', { class: `an-type an-type-${note.type.toLowerCase()}`, text: note.type }),
        ` ${note.date.split('-').reverse().slice(0, 2).join('/')} ${note.time}`)),
    h('button', { class: 'icon-btn an-del', type: 'button', text: '×', title: 'Apagar', 'aria-label': `Apagar ${note.text}`, onClick: () => remove(note) }));
}

function render() {
  if (!ctx) return;
  const open = ctx.notes.filter((n) => !n.done).reverse();
  const done = ctx.notes.filter((n) => n.done).reverse();
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' }, TYPES.map((t) => h('button', {
    class: `seg-btn${ctx.type === t ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(ctx.type === t), text: t,
    onClick: () => { ctx.type = t; render(); },
  })));
  ctx.form.replaceChildren(h('h1', { class: 'display an-title', text: 'Anotador' }),
    h('p', { class: 'small muted', text: `Anote agora, faça em casa. Fica em ${FILE}.` }),
    ctx.input,
    h('div', { class: 'an-actions' }, seg, ctx.publishBtn));
  ctx.list.replaceChildren(...[
    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: `Para fazer em casa · ${open.length}` }),
      open.length ? h('ul', { class: 'an-list' }, open.map(row)) : h('p', { class: 'muted', text: 'Nada pendente.' })),
    done.length ? h('section', { class: 'card an-done' },
      h('div', { class: 'an-done-head' },
        h('h2', { class: 'card-title', text: `Feitas · ${done.length}` }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Tirar feitas', onClick: clearDone })),
      h('ul', { class: 'an-list' }, done.map(row))) : null].filter(Boolean));
}

export default {
  id: 'anotador',
  title: 'Anotador',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 12.5h6M9 16h4"/></svg>',

  async mount(el, api) {
    ctx = { api, el, notes: [], type: 'Tarefa' };
    ctx.input = h('textarea', { class: 'input an-input', rows: '3', placeholder: 'O que você quer fazer quando chegar em casa?', 'aria-label': 'Anotação' });
    ctx.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) publish(); });
    ctx.publishBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Publicar', onClick: publish });
    ctx.form = h('section', { class: 'card an-form' });
    ctx.list = h('div', { class: 'an-lists' });
    el.replaceChildren(ctx.form, ctx.list);
    render();
    await load();
  },

  onVaultChange(paths) {
    if (ctx && paths.includes(FILE)) load();
  },

  unmount() { ctx = null; },
};
