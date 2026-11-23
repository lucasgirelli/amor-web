// Editor de evento (uma nota em Organizador/Agenda/), usado pela Agenda e pela Rotina.
// eventEditor({ api, org, ev, date, startTime, repete, onDone }) -> <form>
//   ev: evento existente ou null (novo); onDone(dadosSalvos | null) depois de salvar, apagar ou cancelar.
import { h } from './dom.js';
import { CATEGORIES, isRoutine } from './organizador.js';
import { REPETE, REPETE_LABEL } from './recorrencia.js';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function field(label, control) {
  return h('label', { class: 'field' }, h('span', { text: label }), control);
}

function sw(label, checked) {
  const cb = h('input', { type: 'checkbox', checked: checked ? true : null });
  return { cb, el: h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), h('span', { text: label })) };
}

export function eventEditor({ api, org, ev = null, date, startTime = null, repete = 'nao', onDone }) {
  const D = api.dates;
  const isNew = !ev;
  const base = ev || {
    titulo: '', data: date, inicio: startTime || '09:00', fim: null, dia_todo: false,
    repete, ate: null, pular_feriados: repete !== 'nao', categoria: null, local: null, obs: '',
  };
  const endDefault = base.fim || (base.inicio ? hhmm(Math.min((D.parseTime(base.inicio) ?? 540) + 60, 23 * 60 + 59)) : '10:00');

  const titulo = h('input', { class: 'input', type: 'text', value: base.titulo, placeholder: 'Ex.: Consulta, Prova de Compiladores' });
  const data = h('input', { class: 'input', type: 'date', value: base.data });
  const allDay = sw('Dia todo', base.dia_todo);
  const inicio = h('input', { class: 'input', type: 'time', value: base.inicio || '09:00' });
  const fim = h('input', { class: 'input', type: 'time', value: endDefault });
  const rep = h('select', { class: 'input' }, REPETE.map((r) => h('option', { value: r, selected: base.repete === r ? true : null, text: REPETE_LABEL[r] })));
  const ate = h('input', { class: 'input', type: 'date', value: base.ate || '' });
  const pular = sw('Pular feriados', base.pular_feriados);
  const categoria = h('select', { class: 'input' }, [['', 'Sem categoria'], ...CATEGORIES.map((c) => [c.id, c.label])]
    .map(([v, label]) => h('option', { value: v, selected: (base.categoria || '') === v ? true : null, text: label })));
  const local = h('input', { class: 'input', type: 'text', value: base.local || '', placeholder: 'Opcional' });
  const obs = h('textarea', { class: 'input', rows: '3', placeholder: 'Observação (vira o corpo da nota)' });
  obs.value = base.obs || '';

  const timeRow = h('div', { class: 'ev-row' }, field('Início', inicio), field('Fim', fim));
  const repeatRow = h('div', { class: 'ev-row' }, field('Até (vazio = sem fim)', ate), h('div', { class: 'field ev-switch-cell' }, pular.el));
  const where = h('p', { class: 'small muted ev-where' });
  const sync = () => {
    timeRow.hidden = allDay.cb.checked;
    repeatRow.hidden = rep.value === 'nao';
    where.textContent = isRoutine({ repete: rep.value })
      ? 'Repete toda semana: aparece na aba Rotina, não no calendário.'
      : 'Aparece no calendário da Agenda.';
  };
  allDay.cb.addEventListener('change', sync);
  rep.addEventListener('change', sync);
  sync();

  const fail = (msg, el) => { api.ui.toast(msg, { type: 'error' }); if (el) el.focus(); };

  const save = async () => {
    const t = titulo.value.trim();
    if (!t) return fail('Escreva o título do evento.', titulo);
    if (!D.fromISO(data.value)) return fail('Escolha a data.', data);
    const dia_todo = allDay.cb.checked;
    if (!dia_todo) {
      const a = D.parseTime(inicio.value);
      const b = D.parseTime(fim.value);
      if (a === null) return fail('Escolha a hora de início.', inicio);
      if (b !== null && b <= a) return fail('O fim precisa ser depois do início.', fim);
    }
    const r = rep.value;
    if (r !== 'nao' && ate.value && ate.value < data.value) return fail('"Até" precisa ser depois da data.', ate);
    const next = {
      titulo: t,
      data: data.value,
      inicio: dia_todo ? null : inicio.value,
      fim: dia_todo || !fim.value ? null : fim.value,
      dia_todo,
      repete: r,
      ate: r !== 'nao' && ate.value ? ate.value : null,
      pular_feriados: r !== 'nao' && pular.cb.checked,
      categoria: categoria.value || null,
      local: local.value.trim() || null,
      obs: obs.value.trim(),
    };
    try {
      await org.saveEvent(ev, next);
      api.ui.toast(isNew ? 'Evento criado.' : 'Evento salvo.', { type: 'ok' });
      onDone(next);
    } catch (err) {
      api.ui.toast(err.message, { type: 'error' });
      org.reload();
    }
  };

  const remove = async () => {
    const yes = await api.ui.confirm({
      title: 'Apagar este evento?',
      message: `"${ev.titulo}"${ev.repete !== 'nao' ? ' e todas as repetições' : ''}. A nota vai para a Lixeira do Windows.`,
      confirmLabel: 'Apagar', danger: true,
    });
    if (!yes) return;
    try {
      await org.deleteEvent(ev);
      api.ui.toast('Evento apagado.', { type: 'ok' });
      onDone(null);
    } catch (err) {
      api.ui.toast(err.message, { type: 'error' });
    }
  };

  const form = h('form', { class: 'card ev-editor', onSubmit: (e) => { e.preventDefault(); save(); } },
    h('h1', { class: 'display', text: isNew ? (isRoutine(base) ? 'Nova atividade da rotina' : 'Novo evento') : 'Editar evento' }),
    !isNew && ev.repete !== 'nao' ? h('p', { class: 'small muted', text: 'As mudanças valem para todas as repetições deste evento.' }) : null,
    field('Título', titulo),
    h('div', { class: 'ev-row' }, field(isRoutine(base) ? 'Começa em' : 'Data', data), h('div', { class: 'field ev-switch-cell' }, allDay.el)),
    timeRow,
    h('div', { class: 'ev-row' }, field('Repete', rep), field('Categoria', categoria)),
    repeatRow,
    where,
    field('Local', local),
    field('Observação', obs),
    h('footer', { class: 'ev-foot' },
      isNew ? h('span') : h('div', { class: 'ev-foot-left' },
        h('button', { class: 'btn btn-danger', type: 'button', text: 'Apagar', onClick: remove }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Abrir no Obsidian', onClick: () => api.vault.openInObsidian(ev.path).catch((err) => api.ui.toast(err.message, { type: 'error' })) })),
      h('div', { class: 'ev-foot-right' },
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancelar', onClick: () => onDone(null) }),
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'Salvar' }))));
  queueMicrotask(() => titulo.focus());
  return form;
}
