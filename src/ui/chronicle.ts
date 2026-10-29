import type { ChronicleEvent, World } from '../core/types';
import { RACES } from '../core/races';

const MAX_DOM = 220;
const KIND_CLASS: Record<string, string> = {
  found: 'k-found',
  grow: 'k-grow',
  nation: 'k-nation',
  coronate: 'k-coronate',
  death: 'k-death',
  tech: 'k-tech',
  war: 'k-war',
  battle: 'k-battle',
  conquer: 'k-conquer',
  peace: 'k-peace',
  disaster: 'k-disaster',
  plague: 'k-plague',
  gift: 'k-gift',
  extinct: 'k-extinct',
  unify: 'k-unify',
  ruin: 'k-ruin',
};

export class Chronicle {
  private list: HTMLElement;
  private rendered = 0;
  /** 只显示重要事件 */
  private filterImportant = false;

  constructor(listEl: HTMLElement) {
    this.list = listEl;
  }

  setFilterImportant(v: boolean): void {
    this.filterImportant = v;
    this.rebuildAll(null);
  }

  reset(): void {
    this.list.innerHTML = '';
    this.rendered = 0;
  }

  /** 每帧调用，增量追加 */
  sync(world: World): void {
    const evs = world.events;
    if (evs.length < this.rendered) {
      this.rebuildAll(world);
      return;
    }
    if (evs.length === this.rendered) return;
    for (let i = this.rendered; i < evs.length; i++) {
      const e = evs[i];
      if (this.filterImportant && e.level < 1) continue;
      this.prepend(e);
    }
    this.rendered = evs.length;
  }

  rebuildAll(world: World | null): void {
    this.list.innerHTML = '';
    this.rendered = 0;
    if (!world) return;
    const start = Math.max(0, world.events.length - MAX_DOM);
    for (let i = start; i < world.events.length; i++) {
      const e = world.events[i];
      if (this.filterImportant && e.level < 1) continue;
      this.prepend(e);
    }
    this.rendered = world.events.length;
  }

  private prepend(e: ChronicleEvent): void {
    const li = document.createElement('li');
    li.className = `${KIND_CLASS[e.kind] ?? ''} lv${e.level}`;
    const yr = document.createElement('span');
    yr.className = 'yr';
    yr.textContent = `${Math.round(e.year)}`;
    const span = document.createElement('span');
    span.textContent = e.text;
    if (e.race >= 0) span.style.color = '';
    li.appendChild(yr);
    li.appendChild(span);
    if (e.race >= 0) {
      li.style.borderLeftColor = li.style.borderLeftColor || RACES[e.race].color;
    }
    this.list.insertBefore(li, this.list.firstChild);
    while (this.list.childElementCount > MAX_DOM) {
      this.list.removeChild(this.list.lastChild as Node);
    }
  }
}
