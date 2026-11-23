// Ideias de projeto: uma nota por ideia em Ideias/ (frontmatter tipo: ideia + seções fixas).
// Funções puras (formato) + ler/gravar pelo api.vault. Usado pela aba Ideias.
import { parseFrontmatter, safeName } from './organizador.js';

export const IDEAS_DIR = 'Ideias';

export const STATUSES = [
  { id: 'ideia', label: 'Só ideia', color: 'var(--cat-financas)' },
  { id: 'desenvolvendo', label: 'Em desenvolvimento', color: 'var(--pen)' },
  { id: 'pausada', label: 'Pausada', color: 'var(--muted)' },
  { id: 'pronta', label: 'Pronta', color: 'var(--ok)' },
  { id: 'descartada', label: 'Descartada', color: 'var(--danger)' },
];
export const statusInfo = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));
// Na lista, o que está em desenvolvimento vem primeiro.
const SORT_ORDER = { desenvolvendo: 0, ideia: 1, pausada: 2, pronta: 3, descartada: 4 };

// Seções do corpo, nesta ordem. Outras seções que o Lucas criar no Obsidian ficam intactas.
const SEC = { desc: 'Descrição', changes: 'Próximas alterações', notes: 'Anotações' };
const FM_KEYS = ['tipo', 'titulo', 'status', 'categoria', 'criada', 'link'];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const HEADING_RE = /^##\s+(.+?)\s*#*\s*$/;
const CHECK_RE = /^\s*[-*] \[([ xX])\] ?(.*)$/;

function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n')) lines.pop();
  return { lines, eol };
}

// Corpo → [{ title|null, lines }] (a primeira, sem título, é o que vem antes do primeiro ##).
function sections(bodyLines) {
  const out = [{ title: null, lines: [] }];
  for (const l of bodyLines) {
    const m = HEADING_RE.exec(l);
    if (m && !l.startsWith('###')) out.push({ title: m[1], lines: [] });
    else out[out.length - 1].lines.push(l);
  }
  return out;
}
const findSec = (secs, name) => secs.find((s) => s.title && fold(s.title) === fold(name));
const trimBlock = (lines) => lines.join('\n').trim();

export function parseIdea(path, text) {
  const fm = parseFrontmatter(text);
  if (!fm || fold(fm.data.tipo) !== 'ideia') return null;
  const d = fm.data;
  const secs = sections(fm.body.split('\n'));
  const ch = findSec(secs, SEC.changes);
  const changes = [];
  const changesExtra = [];
  for (const l of ch ? ch.lines : []) {
    const m = CHECK_RE.exec(l);
    if (m) changes.push({ done: m[1] !== ' ', text: m[2].trim() });
    else if (l.trim()) changesExtra.push(l);
  }
  const status = fold(d.status);
  return {
    path,
    titulo: d.titulo ? String(d.titulo) : path.split('/').pop().replace(/\.md$/i, ''),
    status: STATUS_ORDER[status] !== undefined ? status : 'ideia',
    categoria: d.categoria ? fold(d.categoria) : null,
    criada: d.criada ? String(d.criada).slice(0, 10) : null,
    link: d.link ? String(d.link) : null,
    descricao: findSec(secs, SEC.desc) ? trimBlock(findSec(secs, SEC.desc).lines) : trimBlock(secs[0].lines),
    changes,
    changesExtra,
    anotacoes: findSec(secs, SEC.notes) ? trimBlock(findSec(secs, SEC.notes).lines) : '',
  };
}

const q = (s) => JSON.stringify(String(s));
function fmLine(key, idea) {
  const v = idea[key];
  switch (key) {
    case 'tipo': return 'tipo: ideia';
    case 'titulo': return `titulo: ${q(v || 'Sem título')}`;
    case 'status': return `status: ${v || 'ideia'}`;
    case 'link': return v ? `link: ${q(v)}` : 'link:';
    default: return v ? `${key}: ${v}` : `${key}:`;
  }
}

const changeLines = (idea) => [
  ...idea.changes.filter((c) => c.text.trim()).map((c) => `- [${c.done ? 'x' : ' '}] ${c.text.trim()}`),
  ...(idea.changesExtra || []),
];
function sectionBody(key, idea) {
  if (key === 'desc') return (idea.descricao || '').trim();
  if (key === 'changes') return changeLines(idea).join('\n');
  return (idea.anotacoes || '').trim();
}

export function ideaNote(idea) {
  const out = ['---', ...FM_KEYS.map((k) => fmLine(k, idea)), '---'];
  for (const key of Object.keys(SEC)) {
    const body = sectionBody(key, idea);
    out.push('', `## ${SEC[key]}`, ...(body ? ['', ...body.split('\n')] : []));
  }
  return `${out.join('\n')}\n`;
}

// Atualiza só as chaves e seções que mudaram; o resto da nota (seções extras, outras chaves) fica igual.
export function updateIdeaText(text, idea) {
  const fm = parseFrontmatter(text);
  if (!fm || fold(fm.data.tipo) !== 'ideia') return ideaNote(idea);
  const current = parseIdea('', text);
  const { lines, eol } = splitLines(text);

  // Frontmatter
  let insertAt = fm.close;
  for (const key of FM_KEYS) {
    if (key === 'tipo') continue;
    const want = fmLine(key, idea);
    if (fm.keyLine[key] !== undefined) {
      if (fmLine(key, current) !== want) lines[fm.keyLine[key]] = want;
    } else {
      lines.splice(insertAt, 0, want);
      insertAt++;
    }
  }
  const close = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
  const head = lines.slice(0, close + 1);
  const secs = sections(lines.slice(close + 1));

  // Seções conhecidas: troca o conteúdo só se mudou; a que faltar entra no fim.
  for (const key of Object.keys(SEC)) {
    const want = sectionBody(key, idea);
    const have = key === 'changes' ? changeLines(current).join('\n') : key === 'desc' ? current.descricao : current.anotacoes;
    let sec = findSec(secs, SEC[key]);
    if (sec && want === have) continue;
    if (!sec && key === 'desc' && !want && !have) continue;
    if (!sec && key === 'desc' && have) secs[0].lines = ['']; // texto solto do topo vira a Descrição
    if (!sec) {
      sec = { title: SEC[key], lines: [] };
      secs.push(sec);
    }
    sec.lines = want ? ['', ...want.split('\n'), ''] : [''];
  }

  const body = [];
  for (const s of secs) {
    if (s.title) body.push(`## ${s.title}`);
    body.push(...s.lines);
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  const all = [...head, ...body];
  // Uma linha em branco entre o fim de uma seção e o próximo título.
  for (let i = all.length - 1; i > close + 1; i--) {
    if (HEADING_RE.test(all[i]) && all[i - 1].trim() !== '') all.splice(i, 0, '');
  }
  if (all[close + 1] !== undefined && all[close + 1].trim() !== '') all.splice(close + 1, 0, '');
  return all.join(eol) + eol;
}

export const ideaPath = (titulo) => `${IDEAS_DIR}/${safeName(titulo)}.md`;

export function sortIdeas(list) {
  return [...list].sort((a, b) => (SORT_ORDER[a.status] - SORT_ORDER[b.status]) || (b.mtime || 0) - (a.mtime || 0));
}

// Lê todas as ideias (notas com tipo: ideia em Ideias/, sem subpastas).
export async function loadIdeas(vault) {
  let entries = [];
  try {
    entries = await vault.list(IDEAS_DIR);
  } catch {
    return [];
  }
  const files = entries.filter((e) => e.type === 'file' && /\.md$/i.test(e.path) && !/\/CLAUDE\.md$/i.test(e.path));
  const out = await Promise.all(files.map(async (f) => {
    try {
      const { text } = await vault.read(f.path);
      const idea = parseIdea(f.path, text);
      return idea ? { ...idea, mtime: f.mtime } : null;
    } catch {
      return null;
    }
  }));
  return sortIdeas(out.filter(Boolean));
}
