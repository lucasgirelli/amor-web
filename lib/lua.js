// Fase da lua aproximada (mês sinódico médio a partir de uma lua nova conhecida). Erro de algumas horas.
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // 6/1/2000 18:14 UTC

const NAMES = [
  'Lua nova', 'Lua crescente', 'Quarto crescente', 'Crescente gibosa',
  'Lua cheia', 'Minguante gibosa', 'Quarto minguante', 'Lua minguante',
];

// age: dias desde a lua nova (0..29.53); fraction: parte iluminada (0..1); waxing: crescendo?
export function moonPhase(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const angle = (age / SYNODIC) * 2 * Math.PI;
  const fraction = (1 - Math.cos(angle)) / 2;
  const index = Math.floor((age / SYNODIC) * 8 + 0.5) % 8;
  return { age, fraction, waxing: age < SYNODIC / 2, name: NAMES[index], index };
}

// SVG da lua (24x24): disco escuro com a parte iluminada. Só números calculados aqui; seguro como innerHTML.
export function moonSvg(phase) {
  const r = 9;
  const cx = 12;
  const cy = 12;
  const k = Math.cos((phase.age / SYNODIC) * 2 * Math.PI); // 1 nova, -1 cheia
  const rx = Math.abs(k) * r;
  const lit = phase.waxing ? 1 : 0; // lado iluminado: direito ao crescer
  const outer = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${lit} ${cx} ${cy + r}`;
  const inner = `A ${rx.toFixed(2)} ${r} 0 0 ${k > 0 ? 1 - lit : lit} ${cx} ${cy - r} Z`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" class="moon-dark"/><path d="${outer} ${inner}" class="moon-lit"/><circle cx="${cx}" cy="${cy}" r="${r}" class="moon-rim"/></svg>`;
}
