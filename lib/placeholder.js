// Bloco "em construção" para abas que ainda não foram feitas.
export function placeholder({ title, phase, text, items = [] }) {
  const box = document.createElement('div');
  box.className = 'empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('span');
  p.textContent = text || `Chega na ${phase}.`;
  box.append(strong, p);
  if (items.length) {
    const ul = document.createElement('ul');
    ul.className = 'placeholder-list small';
    for (const it of items) {
      const li = document.createElement('li');
      li.textContent = it;
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}
