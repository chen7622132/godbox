import { TOOLS } from '../sim/tools';
import type { ToolId } from '../core/types';

export interface ToolbarApi {
  setActive: (id: ToolId) => void;
  getActive: () => ToolId;
  setBrush: (n: number) => void;
  getBrush: () => number;
}

export function buildToolbar(
  el: HTMLElement,
  onPick: (id: ToolId) => void,
): ToolbarApi {
  let active: ToolId = 'inspect';
  let brush = 2;
  // 重新创世时会再次调用，先清空避免按钮重复堆叠
  el.innerHTML = '';
  const buttons = new Map<ToolId, HTMLButtonElement>();
  const brushLabel = document.createElement('div');
  brushLabel.className = 'tool-group-title';
  brushLabel.textContent = '笔刷 2';
  brushLabel.style.cursor = 'ew-resize';
  brushLabel.title = '滚轮 / [ ] 调整笔刷大小';

  let group = '';
  for (const t of TOOLS) {
    if (t.group !== group) {
      group = t.group;
      const title = document.createElement('div');
      title.className = 'tool-group-title';
      title.textContent = group;
      el.appendChild(title);
    }
    const b = document.createElement('button');
    b.className = 'tool-btn' + (t.danger ? ' danger' : '');
    b.title = t.hint;
    b.innerHTML = `<span class="t-glyph">${t.glyph}</span><span class="t-label">${t.label}</span>`;
    b.addEventListener('click', () => {
      active = t.id;
      refresh();
      onPick(t.id);
    });
    buttons.set(t.id, b);
    el.appendChild(b);
  }
  el.appendChild(brushLabel);

  function refresh() {
    for (const [id, b] of buttons) b.classList.toggle('active', id === active);
    brushLabel.textContent = `笔刷 ${brush}`;
  }
  refresh();

  return {
    setActive(id) { active = id; refresh(); },
    getActive: () => active,
    setBrush(n) { brush = Math.max(0, Math.min(12, n)); refresh(); },
    getBrush: () => brush,
  };
}
