// Agenda e tarefas no cofre (pasta Organizador/). Funções puras de formato + um store compartilhado.
//
// Tarefas: Organizador/Tarefas.md, colunas = títulos "##", uma tarefa por linha:
//   - [ ] Título 📅 2026-11-20 ⏫ ⭐ 2026-11-15 #categoria
//   subtarefas e observações nas linhas logo abaixo, com um tab a mais.
// Agenda: uma nota por evento em Organizador/Agenda/ com frontmatter (tipo: evento, titulo, data, ...).
//
// Toda mudança altera só as linhas do item; o resto do arquivo fica como estava.
import { toISO, fromISO, addDays, parseTime, WEEKDAYS_SHORT, MONTHS_SHORT, today } from './dates.js';
import { occurrences } from './recorrencia.js';

export const DIR = 'Organizador';
export const AGENDA_DIR = 'Organizador/Agenda';
export const TASKS_FILE = 'Organizador/Tarefas.md';

export const COLUMNS = [
  { id: 'para-fazer', title: 'Para fazer' },
  { id: 'fazendo', title: 'Fazendo' },
  { id: 'em-espera', title: 'Em espera' },
  { id: 'feito', title: 'Feito' },
];

export const CATEGORIES = [
  { id: 'pessoal', label: 'Pessoal' },
  { id: 'faculdade', label: 'Faculdade' },
  { id: 'provas', label: 'Provas' },
  { id: 'tcc', label: 'TCC' },
  { id: 'estagio', label: 'Estágio' },
  { id: 'saude', label: 'Saúde' },
  { id: 'financas', label: 'Finanças' },
  { id: 'casa', label: 'Casa' },
  { id: 'lazer', label: 'Lazer' },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
export const categoryLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: id || 'Sem categoria' }).label;

export const TASKS_TEMPLATE = '---\ntipo: tarefas\n---\n\n## Para fazer\n\n## Fazendo\n\n## Em espera\n\n## Feito\n';

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// Linhas ---------------------------------------------------------------------------------------
function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = text.endsWith('\n');
  const lines = text.split(/\r?\n/);
  if (trailing) lines.pop();
  return { lines, eol, trailing };
}
const joinLines = ({ lines, eol, trailing }) => lines.join(eol) + (trailing || lines.length ? eol : '');

// TAREFAS ===================================================================================
const TASK_RE = /^- \[([ xX])\] ?(.*)$/;
const CHILD_RE = /^(\t| {4})(.*)$/;
const SUBTASK_RE = /^- \[([ xX])\] ?(.*)$/;
const HEADING_RE = /^##\s+(.+?)\s*#*\s*$/;

function columnOfHeading(title) {
  const f = fold(title);
  const col = COLUMNS.find((c) => fold(c.title) === f);
  return col ? col.id : null;
}

// Tokens de uma linha de tarefa -> objeto.
export function parseTaskText(text) {
  let s = ` ${text} `;
  const take = (re) => {
    const m = re.exec(s);
    if (!m) return null;
    s = s.replace(re, ' ');
    return m[1];
  };
  const due = take(/\s📅️?\s*(\d{4}-\d{2}-\d{2})(?=\s)/u);
  const star = take(/\s⭐️?\s*(\d{4}-\d{2}-\d{2})(?=\s)/u);
  const doneDate = take(/\s✅️?\s*(\d{4}-\d{2}-\d{2})(?=\s)/u);
  let prio = 'media';
  if (/[⏫🔺]/u.test(s)) prio = 'alta';
  else if (/[🔽⏬]/u.test(s)) prio = 'baixa';
  s = s.replace(/\s?[⏫🔺🔼🔽⏬]️?/gu, ' ');
  const tags = [];
  s = s.replace(/(^|\s)#([\p{L}\p{N}_\-/]+)(?=\s)/gu, (_m, sp, tag) => { tags.push(tag); return sp; });
  const title = s.replace(/\s+/g, ' ').trim();
  const category = tags.find((t) => CATEGORY_IDS.has(t.toLowerCase())) || null;
  return { title, due, star, doneDate, prio, tags, category: category ? category.toLowerCase() : null };
}

// Objeto -> linha da tarefa (ordem: prazo, prioridade, ⭐, ✅, #categorias).
export function taskLine(t) {
  let s = `- [${t.done ? 'x' : ' '}] ${String(t.title || '').replace(/\s+/g, ' ').trim()}`;
  if (t.due) s += ` 📅 ${t.due}`;
  if (t.prio === 'alta') s += ' ⏫';
  else if (t.prio === 'baixa') s += ' 🔽';
  if (t.star) s += ` ⭐ ${t.star}`;
  if (t.done && t.doneDate) s += ` ✅ ${t.doneDate}`;
  const others = (t.tags || []).filter((x) => !CATEGORY_IDS.has(x.toLowerCase()));
  for (const tag of [...(t.category ? [t.category] : []), ...others]) s += ` #${tag}`;
  return s;
}

// Concluir/reabrir mexendo só no [ ]/[x] e no "✅ data" da linha original.
export function setDoneOnLine(line, done, dateIso) {
  let s = line.replace(/\s✅️?\s*\d{4}-\d{2}-\d{2}/u, '');
  s = s.replace(/^- \[[ xX]\]/, done ? '- [x]' : '- [ ]');
  if (!done) return s;
  const tags = /((?:\s#[\p{L}\p{N}_\-/]+)+)\s*$/u.exec(s);
  return tags ? `${s.slice(0, tags.index)} ✅ ${dateIso}${tags[1]}` : `${s.replace(/\s+$/, '')} ✅ ${dateIso}`;
}

export function taskBlock(t) {
  return [
    taskLine(t),
    ...(t.subtasks || []).filter((x) => x.text.trim()).map((x) => `\t- [${x.done ? 'x' : ' '}] ${x.text.trim()}`),
    ...(t.notes || []).filter((x) => x.trim()).map((x) => `\t${x.trim()}`),
  ];
}

// Arquivo -> { sections, tasks }. Cada tarefa guarda a linha original (raw) para ser achada de novo.
export function parseTasks(text) {
  const { lines } = splitLines(text || '');
  const sections = [];
  const tasks = [];
  let column = null;
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hm = HEADING_RE.exec(line);
    if (hm) {
      column = columnOfHeading(hm[1]);
      sections.push({ title: hm[1], column, line: i });
      continue;
    }
    const tm = TASK_RE.exec(line);
    if (!tm || !column) continue;
    let end = i;
    const subtasks = [];
    const notes = [];
    while (end + 1 < lines.length) {
      const cm = CHILD_RE.exec(lines[end + 1]);
      if (!cm || !lines[end + 1].trim()) break;
      end++;
      const sm = SUBTASK_RE.exec(cm[2]);
      if (sm) subtasks.push({ done: sm[1] !== ' ', text: sm[2] });
      else notes.push(cm[2]);
    }
    const ordinal = seen.get(line) || 0;
    seen.set(line, ordinal + 1);
    const parsed = parseTaskText(tm[2]);
    tasks.push({
      ...parsed,
      done: tm[1] !== ' ',
      column,
      subtasks,
      notes,
      start: i,
      end,
      ref: { raw: line, ordinal },
      key: `${line}#${ordinal}`,
    });
    i = end;
  }
  return { sections, tasks };
}

function findTask(lines, ref) {
  const { tasks } = parseTasks(lines.join('\n'));
  const hit = tasks.find((t) => t.ref.raw === ref.raw && t.ref.ordinal === ref.ordinal)
    || tasks.find((t) => t.ref.raw === ref.raw);
  if (!hit) throw new Error('Essa tarefa mudou no arquivo. A lista foi atualizada; tente de novo.');
  return hit;
}

function sectionBounds(lines, columnId) {
  let h = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (!m) continue;
    if (h >= 0) return { h, end: i };
    if (columnOfHeading(m[1]) === columnId) h = i;
  }
  return h >= 0 ? { h, end: lines.length } : null;
}

function ensureSection(lines, columnId) {
  let b = sectionBounds(lines, columnId);
  if (b) return b;
  const title = COLUMNS.find((c) => c.id === columnId).title;
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length) lines.push('');
  lines.push(`## ${title}`);
  b = sectionBounds(lines, columnId);
  return b;
}

// Insere um bloco na coluna, na posição `index` (0 = topo; Infinity = fim), cuidando das linhas em branco.
function insertBlock(lines, columnId, index, block) {
  const b = ensureSection(lines, columnId);
  const { tasks } = parseTasks(lines.join('\n'));
  const inCol = tasks.filter((t) => t.start > b.h && t.start < b.end);
  let at;
  if (inCol.length && index < inCol.length) at = inCol[Math.max(0, index)].start;
  else if (inCol.length) at = inCol[inCol.length - 1].end + 1;
  else {
    if (lines[b.h + 1] !== '') lines.splice(b.h + 1, 0, '');
    at = b.h + 2;
  }
  lines.splice(at, 0, ...block);
  const after = at + block.length;
  if (after < lines.length && lines[after] !== '' && HEADING_RE.test(lines[after])) lines.splice(after, 0, '');
}

function removeBlock(lines, task) {
  lines.splice(task.start, task.end - task.start + 1);
  // não deixa duas linhas em branco seguidas (nem branco sobrando no fim) onde a tarefa estava
  const i = task.start;
  if (i > 0 && lines[i - 1] === '' && (i >= lines.length || lines[i] === '')) lines.splice(i - 1, 1);
}

function blockOf(lines, t, done, todayIso) {
  const block = lines.slice(t.start, t.end + 1);
  if (done !== t.done) block[0] = setDoneOnLine(block[0], done, todayIso);
  return block;
}

function withLines(text, fn) {
  const doc = splitLines(text || TASKS_TEMPLATE);
  fn(doc.lines);
  return joinLines(doc);
}

// Operações (texto -> texto novo). `ref` = task.ref de parseTasks.
export const tasksOps = {
  add(text, data, column = 'para-fazer', index = Infinity) {
    return withLines(text, (lines) => insertBlock(lines, column, index, taskBlock({ ...data, done: column === 'feito' })));
  },
  update(text, ref, data) {
    return withLines(text, (lines) => {
      const t = findTask(lines, ref);
      const merged = { ...t, ...data };
      lines.splice(t.start, t.end - t.start + 1, ...taskBlock(merged));
    });
  },
  remove(text, ref) {
    return withLines(text, (lines) => removeBlock(lines, findTask(lines, ref)));
  },
  // Mover entre colunas: entrar em Feito conclui (✅ hoje); sair de Feito reabre.
  move(text, ref, toColumn, index, todayIso) {
    return withLines(text, (lines) => {
      const t = findTask(lines, ref);
      const block = blockOf(lines, t, toColumn === 'feito', todayIso);
      removeBlock(lines, t);
      insertBlock(lines, toColumn, index, block);
    });
  },
  // Concluir pelo círculo: [x] + ✅ hoje e vai para o topo de Feito. Reabrir: topo de Para fazer.
  toggle(text, ref, todayIso) {
    return withLines(text, (lines) => {
      const t = findTask(lines, ref);
      const block = blockOf(lines, t, !t.done, todayIso);
      removeBlock(lines, t);
      insertBlock(lines, t.done ? 'para-fazer' : 'feito', 0, block);
    });
  },
  // Salvar do editor: reescreve o bloco da tarefa e, se a coluna mudou, move (Feito conclui, sair reabre).
  save(text, ref, data, column, todayIso) {
    return withLines(text, (lines) => {
      const t = findTask(lines, ref);
      const target = column || t.column;
      const done = target === 'feito';
      const block = taskBlock({ ...t, ...data, done, doneDate: done ? (t.done ? t.doneDate : todayIso) : null });
      if (target === t.column) {
        lines.splice(t.start, t.end - t.start + 1, ...block);
        return;
      }
      removeBlock(lines, t);
      insertBlock(lines, target, target === 'feito' ? 0 : Infinity, block);
    });
  },
  toggleSubtask(text, ref, subIndex) {
    return withLines(text, (lines) => {
      const t = findTask(lines, ref);
      let seen = -1;
      for (let i = t.start + 1; i <= t.end; i++) {
        const cm = CHILD_RE.exec(lines[i]);
        if (!cm || !SUBTASK_RE.test(cm[2])) continue;
        seen++;
        if (seen === subIndex) {
          lines[i] = lines[i].replace(/- \[([ xX])\]/, (_m, c) => `- [${c === ' ' ? 'x' : ' '}]`);
          return;
        }
      }
    });
  },
};

// EVENTOS ===================================================================================
const FM_KEYS = ['tipo', 'titulo', 'data', 'inicio', 'fim', 'dia_todo', 'repete', 'ate', 'pular_feriados', 'categoria', 'local'];
const TRUE = new Set(['true', 'sim', 'yes', 'verdadeiro']);
const FALSE = new Set(['false', 'nao', 'não', 'no', 'falso']);

function parseScalar(raw) {
  let v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2)) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  v = v.replace(/\s+#.*$/, '');
  const low = v.toLowerCase();
  if (TRUE.has(low)) return true;
  if (FALSE.has(low)) return false;
  return v;
}

export function parseFrontmatter(text) {
  const { lines } = splitLines(text || '');
  if (lines[0] !== '---') return null;
  const close = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
  if (close < 0) return null;
  const data = {};
  const keyLine = {};
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[i]);
    if (!m) continue;
    data[m[1]] = parseScalar(m[2]);
    keyLine[m[1]] = i;
  }
  return { data, keyLine, close, body: lines.slice(close + 1).join('\n').trim() };
}

const pad2 = (n) => String(n).padStart(2, '0');
function normTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`; // YAML 1.1 sexagesimal (15:00 -> 900)
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : null;
}

export function parseEvent(path, text) {
  const fm = parseFrontmatter(text);
  if (!fm || String(fm.data.tipo || '').toLowerCase() !== 'evento') return null;
  const d = fm.data;
  const data = d.data ? String(d.data).slice(0, 10) : null;
  if (!data || !fromISO(data)) return null;
  const inicio = normTime(d.inicio);
  const repete = typeof d.repete === 'string' ? fold(d.repete).replace(/\s+/g, '_') : 'nao';
  return {
    path,
    titulo: d.titulo ? String(d.titulo) : path.split('/').pop().replace(/\.md$/i, ''),
    data,
    inicio,
    fim: normTime(d.fim),
    dia_todo: d.dia_todo === true || !inicio,
    repete: repete === 'nao' || !repete ? 'nao' : repete,
    ate: d.ate ? String(d.ate).slice(0, 10) : null,
    pular_feriados: d.pular_feriados === true,
    categoria: d.categoria ? fold(String(d.categoria)) : null,
    local: d.local ? String(d.local) : null,
    obs: fm.body,
  };
}

const q = (s) => JSON.stringify(String(s));
function fmValue(key, ev) {
  const v = ev[key];
  switch (key) {
    case 'tipo': return 'evento';
    case 'titulo': return q(v || 'Sem título');
    case 'inicio': case 'fim': return !ev.dia_todo && v ? q(v) : '';
    case 'dia_todo': case 'pular_feriados': return v ? 'true' : 'false';
    case 'repete': return v || 'nao';
    case 'local': return v ? q(v) : '';
    default: return v ? String(v) : '';
  }
}
const fmLine = (key, ev) => { const v = fmValue(key, ev); return v === '' ? `${key}:` : `${key}: ${v}`; };

export function eventNote(ev) {
  const lines = ['---', ...FM_KEYS.map((k) => fmLine(k, ev)), '---', ''];
  if (ev.obs && ev.obs.trim()) lines.push(ev.obs.trim(), '');
  return lines.join('\n');
}

// Atualiza só as chaves que mudaram (e o corpo, se a observação mudou).
export function updateEventText(text, ev) {
  const fm = parseFrontmatter(text);
  if (!fm) return eventNote(ev);
  const doc = splitLines(text);
  const { lines } = doc;
  const current = parseEvent('', text) || {};
  let insertAt = fm.close;
  for (const key of FM_KEYS) {
    if (key === 'tipo') continue;
    const want = fmLine(key, ev);
    if (fm.keyLine[key] !== undefined) {
      if (fmLine(key, current) !== want) lines[fm.keyLine[key]] = want; // só a chave que mudou de valor
    } else {
      lines.splice(insertAt, 0, want); // chave que faltava entra antes do "---" final
      insertAt++;
    }
  }
  const close = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
  const oldBody = lines.slice(close + 1).join('\n').trim();
  const newBody = (ev.obs || '').trim();
  if (oldBody !== newBody) {
    lines.splice(close + 1, lines.length - close - 1, '', ...(newBody ? newBody.split('\n') : []));
    doc.trailing = true;
  }
  return joinLines(doc);
}

// Nome do arquivo: "AAAA-MM-DD Título.md" (único) ou "Título (dia).md" (repete).
export function safeName(s) {
  return String(s || 'Sem título')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120) || 'Sem título';
}

export function eventFileName(ev) {
  const t = safeName(ev.titulo);
  if (!ev.repete || ev.repete === 'nao') return `${ev.data} ${t}.md`;
  const d = fromISO(ev.data);
  const tag = {
    diario: 'todo dia',
    dias_uteis: 'dias úteis',
    semanal: WEEKDAYS_SHORT[d.getDay()],
    mensal: `dia ${d.getDate()}`,
    anual: `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
  }[ev.repete] || ev.repete;
  return `${t} (${tag}).md`;
}

// Rotina = o que se repete toda semana (semanal, dias úteis, todo dia). Fica na aba Rotina, fora do calendário.
// Mensal e anual continuam no calendário: são datas especiais, não rotina.
export const ROUTINE = new Set(['semanal', 'dias_uteis', 'diario']);
export const isRoutine = (ev) => ROUTINE.has(ev.repete);

// Dias da semana (0 = domingo) em que a rotina acontece.
export function routineWeekdays(ev) {
  if (ev.repete === 'diario') return [0, 1, 2, 3, 4, 5, 6];
  if (ev.repete === 'dias_uteis') return [1, 2, 3, 4, 5];
  if (ev.repete === 'semanal') { const d = fromISO(ev.data); return d ? [d.getDay()] : []; }
  return [];
}

// Ocorrências de todos os eventos num intervalo, ordenadas (dia todo primeiro, depois por hora).
export function occurrencesBetween(events, fromIso, toIso) {
  const out = [];
  for (const ev of events) {
    for (const date of occurrences(ev, fromIso, toIso)) {
      const start = ev.dia_todo ? null : parseTime(ev.inicio);
      let end = ev.dia_todo ? null : parseTime(ev.fim);
      if (start !== null && (end === null || end <= start)) end = Math.min(start + 60, 24 * 60);
      out.push({ ev, date, start, end, allDay: ev.dia_todo || start === null, key: `${ev.path}@${date}` });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)
    || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
    || (a.start ?? 0) - (b.start ?? 0)
    || a.ev.titulo.localeCompare(b.ev.titulo, 'pt-BR'));
}

// STORE =====================================================================================
let store = null;

export function organizer(api) {
  if (!store) store = createStore(api);
  return store;
}

function createStore(api) {
  let events = [];
  let tasksDoc = { sections: [], tasks: [] };
  let tasksExists = false;
  let loading = null;
  let reloadTimer = null;
  const eventCache = new Map(); // path -> { mtime, ev }
  const listeners = new Set();

  const notify = () => { for (const cb of listeners) { try { cb(); } catch (err) { console.error('[organizador]', err); } } };

  async function loadEvents() {
    let entries = [];
    try { entries = await api.vault.list(AGENDA_DIR); } catch { entries = []; }
    const files = entries.filter((e) => e.type === 'file' && e.path.toLowerCase().endsWith('.md'));
    const next = [];
    await Promise.all(files.map(async (f) => {
      const hit = eventCache.get(f.path);
      if (hit && hit.mtime === f.mtime) { if (hit.ev) next.push(hit.ev); return; }
      try {
        const { text } = await api.vault.read(f.path);
        const ev = parseEvent(f.path, text);
        eventCache.set(f.path, { mtime: f.mtime, ev });
        if (ev) next.push(ev);
      } catch { /* nota sumiu entre a lista e a leitura */ }
    }));
    for (const p of [...eventCache.keys()]) if (!files.some((f) => f.path === p)) eventCache.delete(p);
    events = next.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
  }

  async function loadTasks() {
    try {
      const { text } = await api.vault.read(TASKS_FILE);
      tasksDoc = parseTasks(text);
      tasksExists = true;
    } catch {
      tasksDoc = { sections: [], tasks: [] };
      tasksExists = false;
    }
  }

  async function load() {
    await Promise.all([loadEvents(), loadTasks()]);
    notify();
  }

  function reload() {
    loading = load();
    return loading;
  }

  api.vault.onChange((paths) => {
    if (!paths.some((p) => p === DIR || p.startsWith(`${DIR}/`))) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 150);
  });

  const todayIso = () => toISO(today());

  async function patchTasks(fn) {
    await api.vault.patch(TASKS_FILE, (text) => fn(text), { createIfMissing: TASKS_TEMPLATE });
    await reload();
  }

  async function writeNewEvent(ev) {
    const base = eventFileName(ev).replace(/\.md$/, '');
    for (let n = 1; n < 50; n++) {
      const rel = `${AGENDA_DIR}/${n === 1 ? base : `${base} ${n}`}.md`;
      try {
        await api.vault.write(rel, eventNote(ev), { create: true });
        return rel;
      } catch (err) {
        if (!/EXISTE/.test(err.message)) throw err;
      }
    }
    throw new Error('Não consegui escolher um nome para a nota do evento.');
  }

  return {
    ready() { return loading || reload(); },
    reload,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    get events() { return events; },
    get tasks() { return tasksDoc.tasks; },
    get tasksFileExists() { return tasksExists; },
    occurrences(fromIso, toIso) { return occurrencesBetween(events, fromIso, toIso); },
    // Só compromissos avulsos (sem a rotina semanal): é o que o calendário mostra.
    appointments(fromIso, toIso) { return occurrencesBetween(events.filter((e) => !isRoutine(e)), fromIso, toIso); },
    get routine() { return events.filter(isRoutine); },

    // Tarefas
    addTask: (data, column, index) => patchTasks((t) => tasksOps.add(t, data, column, index)),
    updateTask: (task, data) => patchTasks((t) => tasksOps.update(t, task.ref, data)),
    saveTask: (task, data, column) => patchTasks((t) => tasksOps.save(t, task.ref, data, column, todayIso())),
    removeTask: (task) => patchTasks((t) => tasksOps.remove(t, task.ref)),
    moveTask: (task, column, index) => patchTasks((t) => tasksOps.move(t, task.ref, column, index, todayIso())),
    toggleTask: (task) => patchTasks((t) => tasksOps.toggle(t, task.ref, todayIso())),
    toggleSubtask: (task, i) => patchTasks((t) => tasksOps.toggleSubtask(t, task.ref, i)),

    // Eventos
    async saveEvent(original, data) {
      if (!original) {
        const rel = await writeNewEvent(data);
        await reload();
        return rel;
      }
      await api.vault.patch(original.path, (text) => updateEventText(text, data));
      let rel = original.path;
      const wanted = `${AGENDA_DIR}/${eventFileName(data)}`;
      if (wanted !== original.path && original.path.startsWith(`${AGENDA_DIR}/`)) {
        try { rel = (await api.vault.rename(original.path, wanted)).path; } catch { /* nome ocupado: mantém o antigo */ }
      }
      await reload();
      return rel;
    },
    async deleteEvent(ev) {
      await api.vault.trash(ev.path);
      await reload();
    },
  };
}

// Agora / em seguida entre as ocorrências de hoje (só as com horário).
export function nowAndNext(occsToday, nowMin) {
  const timed = occsToday.filter((o) => !o.allDay);
  return {
    current: timed.filter((o) => o.start <= nowMin && nowMin < o.end),
    next: timed.find((o) => o.start > nowMin) || null,
  };
}

// Milissegundos até o próximo início/fim de compromisso de hoje (para redesenhar sem polling).
export function msToNextChange(occsToday, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const marks = [];
  for (const o of occsToday) {
    if (o.allDay) continue;
    if (o.start > nowMin) marks.push(o.start);
    if (o.end > nowMin) marks.push(o.end);
  }
  if (!marks.length) return null;
  return (Math.min(...marks) - nowMin) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 500;
}

// Prioridades do dia: tarefas abertas com ⭐ na data.
export const starredOn = (tasks, iso) => tasks.filter((t) => !t.done && t.star === iso);
export const MAX_STARS = 3;

// Texto curto de prazo: "hoje", "amanhã", "atrasada 2 dias", "20 nov".
export function dueLabel(dueIso, todayIso) {
  if (!dueIso) return null;
  const diff = Math.round((fromISO(dueIso) - fromISO(todayIso)) / 86400000);
  if (diff === 0) return { text: 'hoje', tone: 'today' };
  if (diff === 1) return { text: 'amanhã', tone: 'soon' };
  if (diff < 0) return { text: diff === -1 ? 'ontem' : `há ${-diff} dias`, tone: 'late' };
  if (diff < 7) return { text: WEEKDAYS_SHORT[fromISO(dueIso).getDay()], tone: 'soon' };
  const d = fromISO(dueIso);
  return { text: `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`, tone: 'later' };
}

export { addDays };
