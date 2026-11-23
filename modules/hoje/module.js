// Aba Hoje: saudação, folhinha do dia, tempo na cidade (lib/clima.js), tarefas do dia em destaque (prioridades ★, atrasadas, para hoje;
// em andamento por último) e agenda de hoje com "agora" / "em seguida".
import { h } from '../../lib/dom.js';
import { organizer, categoryLabel, starredOn, dueLabel, nowAndNext, msToNextChange, MAX_STARS } from '../../lib/organizador.js';
import { holidaysOn, nextHoliday } from '../../lib/feriados.js';
import { moonPhase, moonSvg } from '../../lib/lua.js';
import * as clima from '../../lib/clima.js';

let ctx = null;

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const catVar = (el, cat) => { if (cat) el.style.setProperty('--cat', `var(--cat-${cat})`); return el; };

async function toggle(task) {
  try {
    await ctx.org.toggleTask(task);
  } catch (err) {
    ctx.api.ui.toast(err.message, { type: 'error' });
  }
}

// Folhinha -------------------------------------------------------------------------------------
function sheet(d, di, hols) {
  const { MONTHS, WEEKDAYS } = ctx.api.dates;
  const red = d.getDay() === 0 || hols.some((x) => x.type === 'nacional');
  const national = hols.find((x) => x.type === 'nacional');
  return h('div', { class: 'folhinha' },
    h('div', { class: 'folhinha-bind' }),
    h('div', { class: 'folhinha-month display', text: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }),
    h('div', { class: `folhinha-num num${red ? ' is-domingo' : ''}`, text: String(d.getDate()) }),
    h('div', { class: `folhinha-weekday display${red ? ' is-domingo' : ''}`, text: WEEKDAYS[d.getDay()] }),
    national ? h('div', { class: 'folhinha-hol', text: national.name }) : null);
}

function facts(d, di, hols) {
  const D = ctx.api.dates;
  const moon = moonPhase(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  const moonIcon = h('span', { class: 'hj-moon' });
  moonIcon.innerHTML = moonSvg(moon); // SVG calculado aqui, sem dado do usuário
  const nextH = nextHoliday(D.toISO(D.addDays(d, 1)));
  const todayHol = hols.find((x) => x.type !== 'comemorativa');
  const rows = [
    ['Semana do ano', String(D.isoWeek(d))],
    ['Dia do ano', `${D.dayOfYear(d)} de ${D.daysInYear(d.getFullYear())}`],
    ['Fase da lua', h('span', { class: 'hj-moon-row' }, moonIcon, moon.name)],
  ];
  if (todayHol) rows.push(['Hoje', `${todayHol.name}${todayHol.type === 'facultativo' ? ' (ponto facultativo)' : ''}`]);
  if (nextH) {
    const nd = D.fromISO(nextH.date);
    const days = D.daysBetween(di, nextH.date);
    rows.push(['Próximo feriado', `${nextH.name} · ${D.WEEKDAYS_SHORT[nd.getDay()]} ${nd.getDate()} ${D.MONTHS_SHORT[nd.getMonth()]} · em ${days} ${days === 1 ? 'dia' : 'dias'}`]);
  }
  return h('dl', { class: 'hoje-facts card' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v)]));
}

// Agenda --------------------------------------------------------------------------------------
function agendaToday(di) {
  const occs = ctx.org.occurrences(di, di);
  const { current, next } = nowAndNext(occs, ctx.api.dates.nowMinutes());
  const nowSet = new Set(current);
  const list = occs.length
    ? h('ul', { class: 'hj-list' }, occs.map((o) => {
      const badge = nowSet.has(o) ? h('span', { class: 'hj-badge is-now', text: 'agora' })
        : o === next ? h('span', { class: 'hj-badge is-next', text: 'em seguida' }) : null;
      const past = !o.allDay && o.end <= ctx.api.dates.nowMinutes() && !nowSet.has(o);
      return catVar(h('li', { class: `hj-ev${past ? ' is-past' : ''}` },
        h('span', { class: 'hj-time mono', text: o.allDay ? 'dia todo' : `${hhmm(o.start)}${o.ev.fim ? `–${hhmm(o.end)}` : ''}` }),
        h('span', { class: 'hj-ev-title', text: o.ev.titulo }),
        badge), o.ev.categoria);
    }))
    : h('p', { class: 'muted', text: 'Nada marcado para hoje.' });
  return h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'Agenda de hoje' }), list);
}

// Tarefas -------------------------------------------------------------------------------------
function taskRow(t, di, star = false) {
  const due = dueLabel(t.due, di);
  if (due && due.tone === 'today') due.text = ''; // em "Tarefas do dia", o selo "hoje" seria repetido
  return catVar(h('li', { class: 'hj-task' },
    h('button', { class: 'hj-check', type: 'button', title: 'Concluir', 'aria-label': `Concluir ${t.title}`, onClick: () => toggle(t) }),
    star ? h('span', { class: 'hj-star', title: 'Prioridade de hoje', text: '★' }) : null,
    h('span', { class: 'hj-task-title', text: t.title }),
    due && due.text ? h('span', { class: `hj-due is-${due.tone}`, text: due.text }) : null,
    t.category ? h('span', { class: 'hj-cat', text: categoryLabel(t.category) }) : null), t.category);
}

// O destaque da aba (as mesmas tarefas da pílula): prioridades de hoje, atrasadas e para hoje, cada tarefa
// uma vez só. Em andamento (sem prazo vencendo) fica no fim, discreto, e não entra na contagem.
function todayTasks(di) {
  const open = ctx.org.tasks.filter((t) => !t.done);
  const stars = starredOn(open, di).slice(0, MAX_STARS);
  const shown = new Set(stars);
  const late = open.filter((t) => !shown.has(t) && t.due && t.due < di);
  const today = open.filter((t) => !shown.has(t) && t.due === di);
  const doing = open.filter((t) => !shown.has(t) && t.column === 'fazendo' && !(t.due && t.due <= di));
  const count = stars.length + late.length + today.length;
  // Só um grupo principal (ex.: tudo é "para hoje"): o título do cartão já basta.
  const single = [stars, late, today].filter((l) => l.length).length === 1;
  const group = (label, list, cls, star = false) => (list.length
    ? h('div', { class: `hj-group ${cls}`.trim() },
      single && cls !== 'is-doing' ? null : h('h3', { class: 'hj-group-title', text: `${label} · ${list.length}` }),
      h('ul', { class: 'hj-list' }, list.map((t) => taskRow(t, di, star))))
    : null);
  return h('section', { class: 'card hj-today' },
    h('div', { class: 'hj-today-head' },
      h('h2', { class: 'hj-today-title display', text: 'Tarefas do dia' }),
      count ? h('span', { class: 'hj-today-count num', text: String(count) }) : null),
    count
      ? [group('Prioridades', stars, 'is-star', true), group('Atrasadas', late, 'is-late'), group('Para hoje', today, '')]
      : h('p', { class: 'hj-today-empty', text: 'Nenhuma tarefa para hoje. Tudo em dia.' }),
    group('Em andamento', doing, 'is-doing'));
}

// Tempo ---------------------------------------------------------------------------------------
// Desenha só o cartão do tempo (a busca termina depois do resto da aba).
function redrawWeather() {
  if (!ctx || !ctx.weatherEl) return;
  const next = weatherCard();
  ctx.weatherEl.replaceWith(next);
  ctx.weatherEl = next;
}

function loadWeather() {
  const city = ctx.city;
  if (!clima.validCity(city) || !clima.isStale(city) || ctx.weatherBusy) return;
  ctx.weatherBusy = true;
  clima.refresh(city)
    .then(() => { if (ctx) ctx.weatherError = null; })
    .catch((err) => { if (ctx) ctx.weatherError = err.message; })
    .finally(() => { if (!ctx) return; ctx.weatherBusy = false; redrawWeather(); });
}

function cityPicker() {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Nome da cidade', 'aria-label': 'Cidade', value: ctx.city ? ctx.city.name : '' });
  const results = h('div', { class: 'hj-w-results' });
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) { input.focus(); return; }
    results.replaceChildren(h('p', { class: 'small muted', text: 'Procurando…' }));
    try {
      const list = await clima.searchCity(q);
      results.replaceChildren(...(list.length ? list.map((c) => h('button', {
        class: 'hj-w-city', type: 'button',
        onClick: async () => {
          const city = { name: c.name, admin: c.admin, lat: c.lat, lon: c.lon };
          try { await ctx.api.config.set('weatherCity', city); } catch (err) { ctx.api.ui.toast(err.message, { type: 'error' }); return; }
          ctx.city = city;
          ctx.choosing = false;
          redrawWeather();
          loadWeather();
        },
      }, h('b', { text: c.name }), c.admin ? h('span', { class: 'small muted', text: ` · ${c.admin}` }) : null)) : [h('p', { class: 'small muted', text: 'Nenhuma cidade com esse nome.' })]));
    } catch (err) {
      results.replaceChildren(h('p', { class: 'small hj-w-error', text: `Não consegui procurar: ${err.message}` }));
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  setTimeout(() => input.focus(), 0);
  return h('section', { class: 'card hj-weather' },
    h('div', { class: 'hj-w-head' },
      h('h2', { class: 'card-title', text: 'Cidade do tempo' }),
      clima.validCity(ctx.city) ? h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancelar', onClick: () => { ctx.choosing = false; redrawWeather(); } }) : null),
    h('div', { class: 'hj-w-search' }, input, h('button', { class: 'btn btn-primary', type: 'button', text: 'Procurar', onClick: search })),
    results);
}

function weatherCard() {
  const city = ctx.city;
  if (ctx.choosing || !clima.validCity(city)) return cityPicker();
  const entry = clima.cached(city);
  const head = h('div', { class: 'hj-w-head' },
    h('h2', { class: 'card-title', text: `Tempo em ${city.name}` }),
    entry ? h('span', { class: 'small muted', text: `${ctx.weatherBusy ? 'atualizando…' : `às ${new Date(entry.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}` }) : null,
    h('button', { class: 'btn btn-ghost hj-w-change', type: 'button', text: 'Trocar', onClick: () => { ctx.choosing = true; redrawWeather(); } }));
  if (!entry) {
    return h('section', { class: 'card hj-weather' }, head,
      ctx.weatherError
        ? h('p', { class: 'small hj-w-error', text: `Sem previsão agora (${ctx.weatherError}).` })
        : h('p', { class: 'small muted', text: 'Buscando o tempo…' }));
  }
  const { now, day, hours } = entry.data;
  const fact = (k, v) => [h('dt', { text: k }), h('dd', { text: v })];
  return h('section', { class: 'card hj-weather' }, head,
    h('div', { class: 'hj-w-main' },
      h('div', { class: 'hj-w-now' },
        h('span', { class: 'hj-w-emoji', 'aria-hidden': 'true', text: now.emoji }),
        h('span', { class: 'hj-w-temp num', text: `${now.temp}°` }),
        h('div', { class: 'hj-w-desc' },
          h('b', { text: now.text }),
          h('span', { class: 'small muted', text: `sensação ${now.feels}°` }),
          h('span', { class: 'small', text: `Hoje: ${day.text.toLowerCase()}` }))),
      h('dl', { class: 'hj-w-facts' },
        fact('Máx · mín', `${day.max}° · ${day.min}°`),
        fact('Chuva', `${day.rain ?? 0}%${day.rainMm ? ` · ${String(day.rainMm).replace('.', ',')} mm` : ''}`),
        fact('Umidade', `${now.humidity}%`),
        fact('Vento', `${now.wind} km/h`),
        fact('UV máx.', String(day.uv)),
        fact('Sol', `${day.sunrise}–${day.sunset}`))),
    hours.length ? h('ol', { class: 'hj-w-hours' }, hours.map((x) => h('li', { class: 'hj-w-hour' },
      h('span', { class: 'small muted', text: `${x.tomorrow ? 'amanhã ' : ''}${x.hour}h` }),
      h('span', { class: 'hj-w-hemoji', title: x.text, text: x.emoji }),
      h('b', { text: `${x.temp}°` }),
      h('span', { class: `small ${x.rain >= 50 ? 'hj-w-wet' : 'muted'}`, text: `${x.rain ?? 0}%` })))) : null);
}

// ---------------------------------------------------------------------------------------------
async function render() {
  if (!ctx) return;
  const D = ctx.api.dates;
  const d = D.today();
  const di = D.toISO(d);
  const hols = holidaysOn(di);
  const [name, city] = await Promise.all([ctx.api.config.get('userName'), ctx.api.config.get('weatherCity').catch(() => null)]);
  if (!ctx) return;
  ctx.city = clima.validCity(city) ? city : ctx.city;
  ctx.weatherEl = weatherCard();
  ctx.el.replaceChildren(
    h('h1', { class: 'hoje-hello', text: `${D.greeting()}, ${name}` }),
    h('div', { class: 'hoje-top' }, sheet(d, di, hols), facts(d, di, hols)),
    ctx.weatherEl,
    todayTasks(di),
    agendaToday(di),
  );
  // Redesenha no próximo início/fim de compromisso (agora / em seguida).
  clearTimeout(ctx.timer);
  const ms = msToNextChange(ctx.org.occurrences(di, di));
  if (ms !== null) ctx.timer = setTimeout(render, ms);
  loadWeather(); // só busca se a última previsão tem mais de 30 min
}

export default {
  id: 'hoje',
  title: 'Hoje',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><rect x="7.5" y="12.5" width="4.5" height="4.5" rx=".8"/></svg>',

  async mount(el, api) {
    const org = organizer(api);
    ctx = { api, el, org, offs: [], timer: null, city: null, choosing: false, weatherEl: null, weatherBusy: false, weatherError: null };
    el.replaceChildren(h('p', { class: 'muted', text: 'Lendo o dia…' }));
    await org.ready();
    ctx.offs.push(org.subscribe(() => render()));
    ctx.offs.push(api.dates.onDayChange(() => render()));
    const onShow = () => render(); // saudação e "agora" atualizados ao abrir
    el.addEventListener('module:show', onShow);
    ctx.offs.push(() => el.removeEventListener('module:show', onShow));
    await render();
  },

  unmount() {
    if (!ctx) return;
    clearTimeout(ctx.timer);
    for (const off of ctx.offs) off();
    ctx = null;
  },
};
