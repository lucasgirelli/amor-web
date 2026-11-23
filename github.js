// AMOR web: o cofre lido e gravado direto no repositório do GitHub (API REST).
// Mesma interface do src/main/vault.js (summary, list, read, write, rename, trash, search), para as
// abas do widget funcionarem sem mudança. hash = SHA do blob no Git (muda quando o texto muda).
// Cada gravação vira um commit "AMOR web: …". O AMOR do PC puxa sozinho (sync.js).

const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const INDEX_FILES = ['wiki/index.md', 'wiki/hot.md', 'wiki/overview.md', 'wiki/log.md'];
const BLOB_PREFIX = 'amor-blob:';

const isHidden = (rel) => rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');
const isNote = (rel) => rel.toLowerCase().endsWith('.md');
const basename = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const isClaudeMd = (rel) => basename(rel) === 'CLAUDE.md';

function vaultError(code, message) {
  const err = new Error(`[${code}] ${message}`);
  err.code = code;
  return err;
}

// Texto UTF-8 <-> base64 (a API do GitHub manda e recebe o conteúdo em base64).
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Mesmo normalize do vault.js: sem acento, minúsculo, com o MESMO tamanho do original.
export function normalize(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = c.normalize('NFD')[0].toLowerCase();
    out += n.length === 1 ? n : c;
  }
  return out;
}

function cleanPath(rel, { allowHidden = false } = {}) {
  if (typeof rel !== 'string' || rel.length > 1024) throw vaultError('CAMINHO', 'Caminho inválido.');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').some((s) => s === '..' || s === '.' || s === '')) throw vaultError('CAMINHO', 'Caminho inválido.');
  if (!allowHidden && isHidden(clean)) throw vaultError('CAMINHO', 'Pastas e arquivos ocultos ficam de fora.');
  return clean;
}

const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

/**
 * createVault({ repo: 'dono/nome', token, apiBase? }) -> vault
 * vault.onChange(cb) recebe os caminhos que mudaram (gravação daqui ou commit de fora, visto no refresh()).
 */
export function createVault({ repo, token, apiBase = 'https://api.github.com' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw vaultError('REPO', 'Repositório inválido. Use dono/nome.');
  const base = `${apiBase.replace(/\/+$/, '')}/repos/${repo}`;
  const name = repo.split('/')[1];

  let branch = null;
  let head = null; // commit que a árvore abaixo representa
  let files = new Map(); // caminho -> { sha, size }
  let dirs = new Set();
  let ready = null;
  let writeGen = 0; // muda a cada gravação daqui: um refresh que começou antes é descartado
  let queue = Promise.resolve(); // gravações uma de cada vez (cada uma é um commit)
  const blobs = new Map(); // sha -> texto (memória)
  const listeners = new Set();
  let mtimes = new Map(); // caminho -> data do último commit que mexeu nele (só os commits recentes)

  async function gh(path, { method = 'GET', body, allow = [] } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    if (allow.includes(res.status)) return { __status: res.status };
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* sem corpo */ }
    if (res.status === 401) throw vaultError('LOGIN', 'O token do GitHub não vale mais. Cole um novo em Configurações.');
    if (res.status === 403 && /rate limit/i.test(detail)) throw vaultError('LIMITE', 'Limite de pedidos do GitHub. Tente de novo em alguns minutos.');
    if (res.status === 403 || res.status === 404) throw vaultError('ACESSO', `Sem acesso ao repositório ${repo}. Confira o nome e as permissões do token (Contents: leitura e escrita).`);
    const err = vaultError('GITHUB', `GitHub respondeu ${res.status}${detail ? `: ${detail}` : ''}.`);
    err.status = res.status;
    throw err;
  }

  function emit(paths) {
    if (!paths.length) return;
    for (const cb of listeners) {
      try { cb(paths); } catch (err) { console.error('[vault] onChange:', err); }
    }
  }

  function setTree(entries) {
    const nextFiles = new Map();
    const nextDirs = new Set();
    for (const e of entries) {
      if (e.type === 'blob') nextFiles.set(e.path, { sha: e.sha, size: e.size || 0 });
      else if (e.type === 'tree') nextDirs.add(e.path);
    }
    files = nextFiles;
    dirs = nextDirs;
  }

  function rebuildDirs() {
    const next = new Set();
    for (const f of files.keys()) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
    }
    dirs = next;
  }

  async function headCommit() {
    if (!branch) branch = (await gh('')).default_branch || 'main';
    const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  }

  async function fetchTree(commitSha) {
    const commit = await gh(`/git/commits/${commitSha}`);
    const tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
    return tree.tree || [];
  }

  async function load() {
    const sha = await headCommit();
    setTree(await fetchTree(sha));
    head = sha;
    pruneBlobCache();
  }

  function whenReady() {
    if (!ready) ready = load().catch((err) => { ready = null; throw err; });
    return ready;
  }

  // Confere se o repositório andou (commit de outro aparelho ou do AMOR do PC). Devolve os caminhos que mudaram.
  async function refresh() {
    await whenReady();
    const gen = writeGen;
    const sha = await headCommit();
    if (sha === head) return [];
    const entries = await fetchTree(sha);
    if (gen !== writeGen) return []; // gravamos algo nesse meio-tempo: o próximo refresh vê tudo
    const before = files;
    setTree(entries);
    head = sha;
    const changed = [];
    for (const [p, meta] of files) {
      const old = before.get(p);
      if (!old || old.sha !== meta.sha) changed.push(p);
    }
    for (const p of before.keys()) if (!files.has(p)) changed.push(p);
    const visible = changed.filter((p) => !isHidden(p));
    if (visible.length) mtimes = new Map(); // datas recalculadas na próxima vez que a Memória pedir
    emit(visible);
    return visible;
  }

  // Blobs: o conteúdo pelo SHA nunca muda, então dá para guardar no aparelho e não baixar de novo.
  function cachedBlob(sha) {
    if (blobs.has(sha)) return blobs.get(sha);
    try {
      const t = localStorage.getItem(BLOB_PREFIX + sha);
      if (t !== null) { blobs.set(sha, t); return t; }
    } catch { /* sem localStorage */ }
    return null;
  }
  function keepBlob(sha, text) {
    blobs.set(sha, text);
    try { localStorage.setItem(BLOB_PREFIX + sha, text); } catch { /* cheio: fica só na memória */ }
  }
  function pruneBlobCache() {
    try {
      const live = new Set([...files.values()].map((f) => f.sha));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(BLOB_PREFIX) && !live.has(k.slice(BLOB_PREFIX.length))) localStorage.removeItem(k);
      }
    } catch { /* sem localStorage */ }
  }

  async function blobText(sha) {
    const hit = cachedBlob(sha);
    if (hit !== null) return hit;
    const blob = await gh(`/git/blobs/${sha}`);
    const text = blob.encoding === 'base64' ? fromBase64(blob.content) : String(blob.content || '');
    keepBlob(sha, text);
    return text;
  }

  // Leitura -------------------------------------------------------------------------------------
  async function readInternal(rel) {
    await whenReady();
    const meta = files.get(rel);
    if (!meta) throw vaultError('ENOENT', `ENOENT: no such file, ${rel}`);
    if (meta.size > MAX_NOTE_BYTES) throw vaultError('GRANDE', 'Arquivo grande demais.');
    return { text: await blobText(meta.sha), sha: meta.sha };
  }

  async function read(rel) {
    const clean = cleanPath(rel);
    const { text, sha } = await readInternal(clean);
    return { path: clean, text, mtime: mtimes.get(clean) || 0, hash: sha };
  }

  async function list(dir = '') {
    await whenReady();
    const b = dir ? cleanPath(dir) : '';
    const prefix = b ? `${b}/` : '';
    const out = [];
    for (const d of dirs) {
      if (isHidden(d)) continue;
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) out.push({ path: d, type: 'dir' });
    }
    for (const [f, meta] of files) {
      if (isHidden(f)) continue;
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.push({ path: f, type: 'file', mtime: mtimes.get(f) || 0, size: meta.size });
    }
    return out.sort((a, b2) => (a.type === b2.type ? a.path.localeCompare(b2.path, 'pt-BR') : a.type === 'dir' ? -1 : 1));
  }

  // Datas: o Git não guarda data por arquivo; vêm dos últimos commits (até 15), calculadas uma vez.
  let mtimesLoading = null;
  async function loadMtimes() {
    if (mtimes.size) return mtimes;
    if (!mtimesLoading) {
      mtimesLoading = (async () => {
        const list2 = await gh(`/commits?sha=${encodeURIComponent(branch)}&per_page=15`);
        const details = await Promise.all(list2.map((c) => gh(`/commits/${c.sha}`).catch(() => null)));
        const next = new Map();
        for (const d of details) {
          if (!d || !Array.isArray(d.files)) continue;
          const when = Date.parse(d.commit.committer.date) || 0;
          for (const f of d.files) if (!next.has(f.filename)) next.set(f.filename, when);
        }
        mtimes = next;
        return next;
      })().finally(() => { mtimesLoading = null; });
    }
    return mtimesLoading;
  }

  async function claudeMdLines(rel) {
    try { return (await readInternal(rel)).text.split(/\r?\n/).length; } catch { return null; }
  }
  async function readJsonSafe(rel) {
    try { return JSON.parse((await readInternal(rel)).text); } catch { return null; }
  }

  async function summary() {
    await whenReady();
    await loadMtimes().catch(() => null);
    const visibleFiles = [...files.keys()].filter((f) => !isHidden(f));
    const notes = visibleFiles.filter((f) => isNote(f) && !isClaudeMd(f));
    const countUnder = (dir) => notes.filter((n) => n.startsWith(`${dir}/`)).length;
    const visibleDirs = [...dirs].filter((d) => !isHidden(d));

    const folders = [];
    const top = visibleDirs.filter((d) => !d.includes('/')).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const d of top) {
      const children = visibleDirs.filter((c) => c.startsWith(`${d}/`) && c.split('/').length === 2).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      folders.push({ path: d, depth: 1, notes: countUnder(d), claudeMd: files.has(`${d}/CLAUDE.md`) ? await claudeMdLines(`${d}/CLAUDE.md`) : null });
      for (const c of children) {
        folders.push({ path: c, depth: 2, notes: countUnder(c), claudeMd: files.has(`${c}/CLAUDE.md`) ? await claudeMdLines(`${c}/CLAUDE.md`) : null });
      }
    }

    const workspace = files.has('.claude-obsidian.json') ? await readJsonSafe('.claude-obsidian.json') : null;
    const modeFile = files.has('.vault-meta/mode.json') ? await readJsonSafe('.vault-meta/mode.json') : null;
    const inboxDir = (workspace && typeof workspace.source_inbox === 'string' && workspace.source_inbox) || 'inbox';
    const inbox = visibleFiles.filter((f) => f.startsWith(`${inboxDir}/`));
    const wikiPages = notes.filter((n) => n.startsWith('wiki/') && !n.startsWith('wiki/meta/'));
    const recent = notes
      .filter((n) => mtimes.has(n))
      .map((n) => ({ path: n, title: basename(n).replace(/\.md$/i, ''), mtime: mtimes.get(n) }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10);

    return {
      name,
      path: `github.com/${repo}`,
      notes: notes.length,
      rootClaudeMd: files.has('CLAUDE.md') ? await claudeMdLines('CLAUDE.md') : null,
      plugin: workspace ? {
        mode: modeFile && typeof modeFile.mode === 'string' ? modeFile.mode : null,
        inboxDir,
        inbox: inbox.length,
        wikiPages: wikiPages.length,
        indexes: INDEX_FILES.map((p) => ({ path: p, title: basename(p).replace(/\.md$/i, ''), exists: files.has(p), mtime: mtimes.get(p) || null })),
      } : null,
      folders,
      recent,
    };
  }

  // Busca: baixa as notas que ainda não estão no aparelho (de 6 em 6) e procura como o vault.js.
  async function search(query, { limit = 30 } = {}) {
    await whenReady();
    const terms = normalize(String(query || '')).split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);
    if (!terms.length) return [];
    limit = Math.max(1, Math.min(100, limit | 0));
    const notes = [...files.entries()].filter(([p, m]) => isNote(p) && !isHidden(p) && m.size <= MAX_NOTE_BYTES);
    const texts = new Map();
    for (let i = 0; i < notes.length; i += 6) {
      await Promise.all(notes.slice(i, i + 6).map(async ([p, m]) => {
        try { texts.set(p, await blobText(m.sha)); } catch { /* pula */ }
      }));
    }
    const results = [];
    for (const [rel, text] of texts) {
      const norm = normalize(text);
      const nameNorm = normalize(rel);
      let score = 0;
      let first = -1;
      let firstTerm = null;
      let ok = true;
      for (const t of terms) {
        const inName = nameNorm.includes(t);
        const at = norm.indexOf(t);
        if (!inName && at < 0) { ok = false; break; }
        if (inName) score += 10;
        if (at >= 0) {
          let count = 0;
          for (let i = at; i >= 0 && count < 20; i = norm.indexOf(t, i + t.length)) count++;
          score += count;
          if (first < 0 || at < first) { first = at; firstTerm = t; }
        }
      }
      if (ok) results.push({ rel, text, score, first, firstTerm });
    }
    results.sort((a, b) => b.score - a.score || (mtimes.get(b.rel) || 0) - (mtimes.get(a.rel) || 0));
    return results.slice(0, limit).map(({ rel, text, score, first, firstTerm }) => ({
      path: rel,
      title: basename(rel).replace(/\.md$/i, ''),
      score,
      mtime: mtimes.get(rel) || 0,
      ...snippet(text, first, firstTerm ? firstTerm.length : 0),
    }));
  }

  // Gravação: uma de cada vez; cada uma é um commit. -------------------------------------------
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function write(rel, text, { expectHash = null, create = false } = {}) {
    return serial(async () => {
      if (typeof text !== 'string') throw vaultError('TEXTO', 'Conteúdo inválido.');
      const clean = cleanPath(rel);
      if (!isNote(clean)) throw vaultError('TIPO', 'O AMOR só grava notas .md.');
      await whenReady();
      const known = files.get(clean);
      if (create && known) throw vaultError('EXISTE', 'Já existe uma nota com esse nome.');
      if (expectHash && (!known || known.sha !== expectHash)) {
        await refresh().catch(() => {});
        throw vaultError('CONFLITO', 'A nota mudou por fora. Releia e aplique de novo.');
      }
      writeGen++;
      const sha = create ? undefined : (expectHash || (known && known.sha) || undefined);
      const verb = known ? 'editou' : 'criou';
      const res = await gh(`/contents/${encodePath(clean)}`, {
        method: 'PUT',
        body: { message: `AMOR web: ${verb} ${clean}`, content: toBase64(text), branch, ...(sha ? { sha } : {}) },
        allow: [409, 422],
      });
      if (res.__status) {
        await refresh().catch(() => {});
        if (create || !sha) throw vaultError('EXISTE', 'Já existe uma nota com esse nome.');
        throw vaultError('CONFLITO', 'A nota mudou por fora. Releia e aplique de novo.');
      }
      files.set(clean, { sha: res.content.sha, size: new TextEncoder().encode(text).length });
      rebuildDirs();
      keepBlob(res.content.sha, text);
      mtimes.set(clean, Date.now());
      writeGen++;
      emit([clean]);
      return { path: clean, mtime: Date.now(), hash: res.content.sha };
    });
  }

  // Renomear = um commit que tira o caminho antigo e põe o novo (API de baixo nível do Git).
  function rename(fromRel, toRel) {
    return serial(async () => {
      const from = cleanPath(fromRel);
      const to = cleanPath(toRel);
      if (!isNote(from) || !isNote(to)) throw vaultError('TIPO', 'Só notas .md.');
      await whenReady();
      writeGen++;
      for (let attempt = 0; attempt < 3; attempt++) {
        const parent = await headCommit();
        const entries = parent === head ? null : await fetchTree(parent);
        const lookup = entries ? new Map(entries.filter((e) => e.type === 'blob').map((e) => [e.path, e])) : files;
        const src = lookup.get(from);
        if (!src) throw vaultError('ENOENT', `ENOENT: no such file, ${from}`);
        if (lookup.has(to) && to.toLowerCase() !== from.toLowerCase()) throw vaultError('EXISTE', 'Já existe uma nota com esse nome.');
        const commit = await gh(`/git/commits/${parent}`);
        const tree = await gh('/git/trees', {
          method: 'POST',
          body: {
            base_tree: commit.tree.sha,
            tree: [
              { path: from, mode: '100644', type: 'blob', sha: null },
              { path: to, mode: '100644', type: 'blob', sha: src.sha },
            ],
          },
        });
        const next = await gh('/git/commits', { method: 'POST', body: { message: `AMOR web: renomeou ${from} para ${to}`, tree: tree.sha, parents: [parent] } });
        const moved = await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: next.sha }, allow: [409, 422] });
        if (moved && moved.__status) continue; // alguém gravou nesse meio-tempo: tenta de novo
        const meta = files.get(from) || { sha: src.sha, size: src.size || 0 };
        files.delete(from);
        files.set(to, meta);
        rebuildDirs();
        mtimes.set(to, Date.now());
        writeGen++;
        emit([from, to]);
        return { path: to };
      }
      throw vaultError('GITHUB', 'O repositório mudou várias vezes seguidas. Tente de novo.');
    });
  }

  // "Apagar" = commit que remove a nota (dá para recuperar pelo histórico do Git).
  // As abas só chamam depois da confirmação do Lucas.
  function trash(rel) {
    return serial(async () => {
      const clean = cleanPath(rel);
      if (!isNote(clean)) throw vaultError('TIPO', 'Só notas .md.');
      await whenReady();
      const known = files.get(clean);
      if (!known) return true;
      writeGen++;
      const res = await gh(`/contents/${encodePath(clean)}`, {
        method: 'DELETE',
        body: { message: `AMOR web: apagou ${clean}`, sha: known.sha, branch },
        allow: [409, 422],
      });
      if (res && res.__status) {
        await refresh().catch(() => {});
        throw vaultError('CONFLITO', 'A nota mudou por fora. Abra de novo e confirme.');
      }
      files.delete(clean);
      rebuildDirs();
      writeGen++;
      emit([clean]);
      return true;
    });
  }

  function openInObsidian(rel) {
    const clean = cleanPath(rel).replace(/\.md$/i, '');
    window.location.href = `obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(clean)}`;
    return Promise.resolve(true);
  }

  return {
    name,
    repo,
    whenReady,
    refresh,
    summary,
    list,
    read,
    write,
    rename,
    trash,
    search,
    openInObsidian,
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

// Trecho da linha onde o termo aparece (igual ao vault.js).
function snippet(text, at, len) {
  if (at < 0) {
    const firstLine = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('---')) || '';
    return { line: null, before: firstLine.slice(0, 160), match: '', after: '' };
  }
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  let lineEnd = text.indexOf('\n', at);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(0, at).split('\n').length;
  const from = Math.max(lineStart, at - 70);
  const to = Math.min(lineEnd, at + len + 90);
  return {
    line,
    before: (from > lineStart ? '…' : '') + text.slice(from, at).replace(/^\s+/, ''),
    match: text.slice(at, at + len),
    after: text.slice(at + len, to).replace(/\r$/, '') + (to < lineEnd ? '…' : ''),
  };
}
