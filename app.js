// AMOR web: casca do site (abas, avisos, confirmações, Configurações) em volta das MESMAS abas do widget.
// O cofre vem do GitHub (github.js). Nada sai do aparelho além dos pedidos à API do GitHub.
import * as dates from './lib/dates.js';
import { h } from './lib/dom.js';
import { createVault } from './github.js';

const VERSION = '1.2.0';
const MODULES = ['hoje', 'agenda', 'rotina', 'tarefas', 'anotador'];
const REFRESH_MS = 30000; // confere commits novos a cada 30 s com o site aberto e visível
const CONFIG_KEY = 'amor-web-config';
const $ = (sel) => document.querySelector(sel);

const els = {
  app: $('#app'),
  setup: $('#setup'),
  tabs: $('#tabs'),
  body: $('#panel-body'),
  title: $('#top-title'),
  date: $('#top-date'),
  sync: $('#top-sync'),
  btnSettings: $('#btn-settings'),
  btnRefresh: $('#btn-refresh'),
  toasts: $('#toasts'),
  confirmLayer: $('#confirm-layer'),
};

const state = {
  vault: null,
  active: null,
  view: 'module',
  modules: new Map(),
  order: [],
  confirmResolve: null,
  settingsEl: null,
  refreshTimer: null,
  refreshing: null,
  lastRefresh: 0,
};

// Configuração no próprio navegador -------------------------------------------------------------
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}
function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

// Avisos e confirmação (iguais aos do widget) ----------------------------------------------------
function toast(message, { type = 'info', timeout = 3200 } = {}) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = String(message).replace(/^(?:\w*Error: )?/, '').replace(/^\[[A-Z_]+\]\s*/, '');
  els.toasts.append(t);
  setTimeout(() => {
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 200);
  }, timeout);
}

function confirm({ title = 'Confirmar', message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
  if (state.confirmResolve) state.confirmResolve(false);
  return new Promise((resolve) => {
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: cancelLabel });
    const ok = h('button', { type: 'button', class: `btn btn-primary${danger ? ' btn-danger' : ''}`, text: confirmLabel });
    const box = h('div', { class: 'confirm', role: 'alertdialog', 'aria-modal': 'true' },
      h('h2', { text: title }), h('p', { text: message }), h('div', { class: 'confirm-actions' }, cancel, ok));
    const done = (value) => {
      if (state.confirmResolve !== done) return;
      state.confirmResolve = null;
      els.confirmLayer.hidden = true;
      els.confirmLayer.replaceChildren();
      resolve(value);
    };
    state.confirmResolve = done;
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    els.confirmLayer.replaceChildren(box);
    els.confirmLayer.hidden = false;
    ok.focus();
  });
}

// API entregue às abas (mesmo contrato do shell.js do widget) -----------------------------------
const vaultListeners = new Set();
function dispatchVaultChange(paths) {
  for (const entry of state.modules.values()) {
    if (entry.mounted && typeof entry.mod.onVaultChange === 'function') {
      try { entry.mod.onVaultChange(paths); } catch (err) { console.error(`[web] onVaultChange(${entry.mod.id}):`, err); }
    }
  }
  for (const cb of vaultListeners) {
    try { cb(paths); } catch (err) { console.error('[web] vault.onChange:', err); }
  }
}

// Lê, aplica transform e grava com o hash lido; se a nota mudou nesse meio-tempo, relê e reaplica.
async function patchNote(rel, transform, { createIfMissing = null } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cur;
    try {
      cur = await state.vault.read(rel);
    } catch (err) {
      if (createIfMissing === null || !/ENOENT|no such file/i.test(err.message)) throw err;
      cur = { text: createIfMissing, hash: null };
    }
    const next = transform(cur.text);
    if (typeof next !== 'string' || next === cur.text) return cur;
    try {
      return await state.vault.write(rel, next, cur.hash ? { expectHash: cur.hash } : { create: true });
    } catch (err) {
      if (/\[(CONFLITO|EXISTE)\]/.test(err.message)) continue;
      throw err;
    }
  }
  throw new Error('A nota mudou várias vezes seguidas. Tente de novo.');
}

function openUrl(url) {
  if (!/^https?:\/\//i.test(String(url))) return Promise.resolve(false);
  window.open(url, '_blank', 'noopener');
  return Promise.resolve(true);
}

let api = null;
function buildApi() {
  const v = state.vault;
  return Object.freeze({
    vault: Object.freeze({
      summary: () => v.summary(),
      list: (dir) => v.list(dir),
      read: (rel) => v.read(rel),
      write: (rel, text, opts) => v.write(rel, text, opts),
      patch: patchNote,
      rename: (from, to) => v.rename(from, to),
      trash: (rel) => v.trash(rel),
      search: (q, opts) => v.search(q, opts),
      onChange: (cb) => { vaultListeners.add(cb); return () => vaultListeners.delete(cb); },
      openInObsidian: (rel) => v.openInObsidian(rel),
    }),
    claude: Object.freeze({ send: async () => false, focus: async () => {}, session: Object.freeze({}) }), // sem Claude na web
    config: Object.freeze({
      get: async (key) => { const c = { userName: 'você', ...loadConfig() }; return key ? c[key] ?? null : c; },
      set: async (key, value) => { saveConfig({ [key]: value }); return value; },
    }),
    ui: Object.freeze({ toast, confirm, openUrl }),
    // Sem data do arquivo (o Git não guarda por arquivo), "há quanto tempo" fica em branco.
    dates: Object.freeze({ ...dates, formatRelative: (ms, now) => (ms ? dates.formatRelative(ms, now) : '') }),
  });
}

// Sincronização: confere o GitHub ao abrir, ao voltar para o app e a cada 30 s ----------------------
function setSync(stateName, text) {
  els.sync.dataset.state = stateName;
  els.sync.title = text;
  els.sync.setAttribute('aria-label', text);
}

function refreshNow({ quiet = true } = {}) {
  if (!state.vault) return Promise.resolve();
  if (state.refreshing) return state.refreshing;
  setSync('syncing', 'Conferindo o GitHub…');
  state.refreshing = state.vault.refresh()
    .then((changed) => {
      state.lastRefresh = Date.now();
      setSync('ok', `Em dia com o GitHub (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`);
      if (!quiet) toast(changed.length ? `${changed.length} nota(s) atualizada(s).` : 'Tudo em dia.', { type: 'ok' });
    })
    .catch((err) => {
      setSync('error', err.message.replace(/^\[[A-Z_]+\]\s*/, ''));
      if (!quiet || /\[LOGIN\]/.test(err.message)) toast(err.message, { type: 'error', timeout: 6000 });
    })
    .finally(() => { state.refreshing = null; });
  return state.refreshing;
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => { if (!document.hidden) refreshNow(); }, REFRESH_MS);
}

// Abas ------------------------------------------------------------------------------------------
function loadStyle(id) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `modules/${id}/style.css`;
  document.head.append(link);
}

function addTab(id, mod) {
  const tab = h('button', { type: 'button', class: 'tab', id: `tab-${id}`, role: 'tab', 'aria-selected': 'false', 'aria-controls': `module-${id}` });
  const icon = h('span', { class: 'tab-icon', 'aria-hidden': 'true' });
  icon.innerHTML = typeof mod.icon === 'string' ? mod.icon : ''; // SVG fixo do próprio módulo
  tab.append(icon, h('span', { class: 'tab-label', text: mod.title }));
  tab.addEventListener('click', () => activate(id));
  els.tabs.append(tab);
  const el = h('section', { class: `module module-${id}`, id: `module-${id}`, role: 'tabpanel', 'aria-labelledby': tab.id });
  el.hidden = true;
  els.body.append(el);
  return { tab, el };
}

async function ensureMounted(id) {
  const entry = state.modules.get(id);
  if (!entry || entry.mounted) return;
  entry.mounted = true;
  try {
    await entry.mod.mount(entry.el, api);
  } catch (err) {
    console.error(`[web] mount(${id}):`, err);
    entry.el.replaceChildren(h('p', { class: 'module-error', text: `Não consegui abrir esta aba: ${err.message}` }));
  }
}

async function activate(id) {
  if (!state.modules.has(id)) return;
  state.view = 'module';
  els.btnSettings.setAttribute('aria-selected', 'false');
  if (state.settingsEl) state.settingsEl.hidden = true;
  state.active = id;
  for (const [mid, entry] of state.modules) {
    const on = mid === id;
    entry.tab.setAttribute('aria-selected', String(on));
    entry.el.hidden = !on;
  }
  els.title.textContent = state.modules.get(id).mod.title;
  els.body.scrollTop = 0;
  saveConfig({ lastTab: id });
  await ensureMounted(id);
  if (state.active === id && state.view === 'module') state.modules.get(id).el.dispatchEvent(new CustomEvent('module:show'));
}

// Configurações --------------------------------------------------------------------------------
function card(title, ...children) {
  return h('section', { class: 'card set-card' }, h('h2', { class: 'card-title', text: title }), ...children);
}

function showSettings() {
  state.view = 'settings';
  for (const entry of state.modules.values()) {
    entry.el.hidden = true;
    entry.tab.setAttribute('aria-selected', 'false');
  }
  els.btnSettings.setAttribute('aria-selected', 'true');
  els.title.textContent = 'Configurações';
  if (!state.settingsEl) {
    state.settingsEl = h('section', { class: 'module settings-view' });
    els.body.append(state.settingsEl);
  }
  state.settingsEl.hidden = false;
  const cfg = loadConfig();
  const name = h('input', { class: 'input', type: 'text', value: cfg.userName || '', placeholder: 'Seu nome', 'aria-label': 'Seu nome' });
  state.settingsEl.replaceChildren(h('div', { class: 'settings' },
    card('Seu nome',
      h('p', { class: 'small muted', text: 'Usado na saudação da aba Hoje.' }),
      h('div', { class: 'settings-row' }, name,
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Salvar', onClick: () => { saveConfig({ userName: name.value.trim() }); toast('Nome salvo.', { type: 'ok' }); } }))),
    card('Cofre no GitHub',
      h('p', { class: 'mono small', text: cfg.repo || '' }),
      h('p', { class: 'small muted', text: 'Cada mudança feita aqui vira um commit "AMOR web: …". O AMOR do PC puxa sozinho. Este site confere o GitHub ao abrir, ao voltar para ele e a cada 30 s.' }),
      h('div', { class: 'settings-row' },
        h('button', { class: 'btn', type: 'button', text: 'Conferir agora', onClick: () => refreshNow({ quiet: false }) }),
        h('button', {
          class: 'btn btn-ghost', type: 'button', text: 'Sair deste aparelho',
          onClick: async () => {
            const yes = await confirm({ title: 'Sair deste aparelho?', message: 'O token do GitHub é apagado deste navegador. Para voltar, cole o token de novo.', confirmLabel: 'Sair', danger: true });
            if (!yes) return;
            saveConfig({ token: '' });
            location.reload();
          },
        }))),
    card('Como app no celular',
      h('p', { class: 'small', text: 'iPhone: abra no Safari, toque em Compartilhar e em "Adicionar à Tela de Início". Android: menu do Chrome, "Adicionar à tela inicial".' })),
    h('p', { class: 'small muted', text: `AMOR web ${VERSION}` })));
}

// Login: repositório + token (só neste navegador) ------------------------------------------------
function showSetup(message = '') {
  els.app.hidden = true;
  els.setup.hidden = false;
  const cfg = loadConfig();
  const repo = h('input', { class: 'input mono', type: 'text', value: cfg.repo || '', placeholder: 'dono/cofre', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Repositório' });
  const who = h('input', { class: 'input', type: 'text', value: cfg.userName || '', placeholder: 'Como o AMOR te chama', autocomplete: 'given-name', 'aria-label': 'Seu nome' });
  const token = h('input', { class: 'input mono', type: 'password', value: '', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'Token do GitHub' });
  const err = h('p', { class: 'setup-error', text: message, role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Entrar' });
  const form = h('form', {
    class: 'card setup-card',
    onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Conferindo…';
      try {
        const v = createVault({ repo: repo.value.trim(), token: token.value.trim(), apiBase: cfg.apiBase });
        await v.whenReady();
        saveConfig({ repo: v.repo, token: token.value.trim(), ...(who.value.trim() ? { userName: who.value.trim() } : {}) });
        location.reload();
      } catch (e2) {
        err.textContent = e2.message.replace(/^\[[A-Z_]+\]\s*/, '');
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    },
  },
  h('h1', { class: 'display setup-title', text: 'AMOR' }),
  h('p', { text: 'Sua agenda, tarefas e ideias do cofre, de qualquer lugar. Os dados ficam no seu repositório do GitHub; o token fica só neste navegador.' }),
  h('label', { class: 'setup-label' }, h('span', { text: 'Seu nome' }), who),
  h('label', { class: 'setup-label' }, h('span', { text: 'Repositório do cofre' }), repo),
  h('label', { class: 'setup-label' }, h('span', { text: 'Token do GitHub' }), token),
  h('details', { class: 'setup-help small' },
    h('summary', { text: 'Como criar o token' }),
    h('ol', {},
      h('li', { text: 'No GitHub: Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.' }),
      h('li', { text: 'Repository access: "Only select repositories" e escolha só o repositório do cofre.' }),
      h('li', { text: 'Permissions > Repository permissions > Contents: "Read and write".' }),
      h('li', { text: 'Escolha a validade (ex.: 1 ano), gere e cole aqui.' }))),
  err,
  btn);
  els.setup.replaceChildren(form);
}

// Início ---------------------------------------------------------------------------------------
function renderDate() {
  const d = dates.today();
  els.date.textContent = dates.capitalize(dates.formatLong(d));
}

async function init() {
  const cfg = loadConfig();
  if (!cfg.repo || !cfg.token) { showSetup(); return; }
  try {
    state.vault = createVault({ repo: cfg.repo, token: cfg.token, apiBase: cfg.apiBase });
    await state.vault.whenReady();
  } catch (err) {
    showSetup(err.message.replace(/^\[[A-Z_]+\]\s*/, ''));
    return;
  }
  api = buildApi();
  state.vault.onChange(dispatchVaultChange);
  setSync('ok', 'Em dia com o GitHub');
  state.lastRefresh = Date.now();
  renderDate();
  dates.onDayChange(renderDate);

  for (const id of MODULES) {
    try {
      const mod = (await import(`./modules/${id}/module.js`)).default;
      if (!mod || mod.id !== id || typeof mod.mount !== 'function') throw new Error('não segue o contrato de módulo');
      loadStyle(id);
      const { tab, el } = addTab(id, mod);
      state.modules.set(id, { mod, tab, el, mounted: false });
      state.order.push(id);
    } catch (err) {
      console.error(`[web] módulo ${id}:`, err);
    }
  }

  els.btnSettings.addEventListener('click', showSettings);
  els.btnRefresh.addEventListener('click', () => refreshNow({ quiet: false }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.confirmResolve) state.confirmResolve(false); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      dates.refreshDay?.();
      if (Date.now() - state.lastRefresh > 5000) refreshNow();
    }
  });
  window.addEventListener('focus', () => { if (Date.now() - state.lastRefresh > 5000) refreshNow(); });
  scheduleRefresh();

  const first = state.modules.has(cfg.lastTab) ? cfg.lastTab : state.order[0];
  if (first) activate(first);
}

init();
