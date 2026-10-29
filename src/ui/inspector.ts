import { TERRAIN_NAME, TIER_NAME, TECH_NAME, type World } from '../core/types';
import { RACES } from '../core/races';

export class Inspector {
  private el: HTMLElement;
  private world: World | null = null;
  private sid: number | null = null;
  /** 内容签名：没变化就不重建 DOM */
  private sig = '';

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('close')) {
        this.hide();
      }
    });
  }

  hide(): void {
    this.sid = null;
    this.sig = '';
    this.el.hidden = true;
  }

  get selected(): number | null {
    return this.sid;
  }

  /** 显示某个聚落（或某格的地形信息） */
  show(world: World, sid: number | null, cell?: { x: number; y: number }): void {
    this.world = world;
    this.sid = sid;

    if (sid === null) {
      if (!cell) { this.hide(); return; }
      const i = cell.y * world.w + cell.x;
      const sig = `c${cell.x},${cell.y}|${world.terrain[i]}|${world.fire[i] ? 1 : 0}|${world.plague[i] ? 1 : 0}|${world.owner[i]}`;
      if (sig === this.sig) return;
      this.sig = sig;
      const t = world.terrain[i];
      const f = world.fert[i];
      const oid = world.owner[i];
      const owner = oid >= 0 ? world.settlements[oid] : undefined;
      const rows: string[] = [
        `<h3>${TERRAIN_NAME[t] ?? '未知'} <span style="float:right;font-size:10px;color:#74839a">(${cell.x}, ${cell.y})</span></h3>`,
        row('肥力', `${f} / 255`),
      ];
      if (owner) {
        rows.push(row('归属', `${owner.name}（${RACES[owner.race].name}）`));
      } else {
        rows.push(row('归属', '无主之地'));
      }
      if (world.fire[i] > 0) rows.push(row('状态', '<span style="color:#e0863f">燃烧中</span>'));
      if (world.plague[i] > 0) rows.push(row('状态', '<span style="color:#b06ad0">瘟疫污染</span>'));
      this.el.innerHTML = `<button class="mini close">✕</button>${rows.join('')}`;
      this.el.hidden = false;
      return;
    }

    const s = world.settlements[sid];
    if (!s || !s.alive || s.ruin) { this.hide(); return; }
    const race = RACES[s.race];
    const n = s.nation >= 0 ? world.nations[s.nation] : undefined;
    const sig = `s${sid}|${Math.round(s.pop)}|${s.tier}|${s.walls}|${s.nation}|${n ? n.tech : 0}|${n ? n.enemies.length : 0}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const king = n ? world.agents[n.king] : undefined;

    // 只统计该城半径内的格子，别扫全图
    let area = 0;
    const rr = Math.ceil(2 + Math.sqrt(s.pop) * 0.62) + 2;
    for (let dy = -rr; dy <= rr; dy++) {
      const y = s.y + dy;
      if (y < 0 || y >= world.h) continue;
      for (let dx = -rr; dx <= rr; dx++) {
        const x = s.x + dx;
        if (x < 0 || x >= world.w) continue;
        if (world.owner[y * world.w + x] === s.id) area++;
      }
    }

    const rows: string[] = [];
    rows.push(`<h3>${s.name}${s.capital ? ' ★' : ''}</h3>`);
    rows.push(
      `<div style="margin-bottom:6px">
        <span class="tag" style="color:${race.color}">${race.name}</span>
        <span class="tag" style="color:#74839a">${TIER_NAME[s.tier]}</span>
        ${s.walls > 0 ? `<span class="tag" style="color:#9aa4b2">城墙 ${s.walls}</span>` : ''}
        ${n ? `<span class="tag" style="color:${n.color}">${n.name}</span>` : '<span class="tag" style="color:#6a7684">独立</span>'}
      </div>`,
    );
    rows.push(row('人口', `${Math.round(s.pop)} / ${Math.round(s.cap)}`));
    rows.push(row('领地', `${area} 格`));
    rows.push(row('建于', `第 ${Math.round(s.founded)} 年`));
    if (n) {
      rows.push('<div class="sep"></div>');
      rows.push(row('国王', king && king.alive ? `${king.name}（${Math.round(king.age)}岁）` : '虚位'));
      rows.push(row('科技', TECH_NAME[n.tech] ?? String(n.tech)));
      rows.push(row('城市', `${n.cities.length} 座`));
      if (n.enemies.length) {
        const enemies = n.enemies.map((id) => world.nations[id]?.name).filter(Boolean).join('、');
        rows.push(row('交战', `<span style="color:#e0553f">${enemies}</span>`));
      } else {
        rows.push(row('交战', '无'));
      }
    }
    this.el.innerHTML = `<button class="mini close" style="position:absolute;top:6px;right:6px">✕</button>${rows.join('')}`;
    this.el.hidden = false;
  }
}

function row(k: string, v: string): string {
  return `<div class="row"><span>${k}</span><span>${v}</span></div>`;
}
