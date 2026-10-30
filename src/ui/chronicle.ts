import type { ChronicleEvent, World } from '../core/types';
import { RACES } from '../core/races';
import { cnNum } from '../core/narrative';

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
  revolt: 'k-disaster',
  betray: 'k-war',
  feud: 'k-feud',
  legend: 'k-legend',
};

export class Chronicle {
  private list: HTMLElement;
  private rendered = 0;
  /** 只显示重要事件 */
  private filterImportant = false;
  /** 上一次渲染的卷号，用于插卷头 */
  private lastEra: number | null = null;

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
    this.lastEra = null;
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
    this.lastEra = null;
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
    if (e.kind === 'legend' || e.kind === 'feud') li.classList.add('ev-epic');

    const head = document.createElement('div');
    head.className = 'ev-head';

    const yr = document.createElement('span');
    yr.className = 'yr';
    yr.textContent = `${Math.round(e.year)}`;

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = e.text;

    head.appendChild(yr);
    head.appendChild(txt);
    li.appendChild(head);

    // 「因」—— 这一行是因果链，让编年史读起来不是随机事件
    if (e.cause) {
      const c = document.createElement('div');
      c.className = 'ev-cause';
      c.textContent = `因：${e.cause}`;
      li.appendChild(c);
    }

    // 台词 —— 人味全在这里
    if (e.quote) {
      const q = document.createElement('div');
      q.className = 'ev-quote';
      q.textContent = e.quote;
      li.appendChild(q);
    }

    if (e.race >= 0) {
      li.style.borderLeftColor = RACES[e.race].color;
    }

    this.list.insertBefore(li, this.list.firstChild);

    // 卷首：事件是倒序插入的，所以卷头要落在「该卷最新那条」的上方
    const era = e.era ?? 0;
    if (this.lastEra !== null && era !== this.lastEra) {
      const vol = document.createElement('li');
      vol.className = 'vol';
      vol.textContent = `第 ${cnNum(era + 1)} 卷`;
      this.list.insertBefore(vol, li);
    }
    this.lastEra = era;

    while (this.list.childElementCount > MAX_DOM) {
      this.list.removeChild(this.list.lastChild as Node);
    }
  }

}
