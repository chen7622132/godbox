import { TERRAIN_NAME, TIER_NAME, TECH_NAME, FOOD_NAME, type World } from '../core/types';
import { RACES } from '../core/races';

/** 民情文案与配色 */
const MOOD_TXT: Record<string, string> = {
  happy: '欢欣',
  normal: '平静',
  sad: '悲苦',
  angry: '暴怒',
};
const MOOD_COL: Record<string, string> = {
  happy: '#8cdc6a',
  normal: '#9aa4b2',
  sad: '#5aaef0',
  angry: '#ff5a3c',
};

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
    const sig = `s${sid}|${Math.round(s.pop)}|${s.tier}|${s.walls}|${s.nation}|${n ? n.tech : 0}|${n ? n.enemies.length : 0}|${s.mood}|${s.happiness ? Math.round(s.happiness) : 0}|${n ? n.king : -1}`;
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

    // ---- 奇观：谁在造、造到几成 ----
    const wk = world.wonders?.find((w) => w.city === s.id && !w.ruined) ?? null;
    const built = world.wonders?.find((w) => w.city === s.id && w.built) ?? null;
    if (built) {
      rows.push('<div class="sep"></div>');
      rows.push(`<div class="sec-title">世界奇观</div>`);
      rows.push(
        `<div class="king-row"><div class="kr-head"><span class="kn">${built.name}</span>` +
        `<span class="ks">建于第 ${Math.round(built.finished)} 年</span></div>` +
        `<div class="kd">当世唯一。见此物者，不论敌友，皆须仰视。</div></div>`,
      );
    } else if (wk) {
      rows.push('<div class="sep"></div>');
      rows.push(`<div class="sec-title">工程进行中</div>`);
      rows.push(
        `<div class="king-row"><div class="kr-head"><span class="kn">${wk.name}</span>` +
        `<span class="ks">${Math.round(wk.progress * 100)}%</span></div>` +
        `<div class="kd">始于第 ${Math.round(wk.started)} 年。城破则工废。</div></div>`,
      );
    }

    // ---- 同盟 ----
    if (n && n.allies && n.allies.length) {
      const allyNames = n.allies
        .map((id) => world.nations[id]?.name)
        .filter(Boolean)
        .join('、');
      if (allyNames) rows.push(row('姻亲', `<span style="color:#7fd07f">${allyNames}</span>`));
    }

    // ---- 民情：情绪系统是核心机制，玩家必须能在界面上看见 ----
    const mood = s.mood ?? 'normal';
    rows.push('<div class="sep"></div>');
    rows.push(
      row('民情', `<span style="color:${MOOD_COL[mood] ?? '#9aa4b2'}">${MOOD_TXT[mood] ?? '平静'}</span>` +
        `<span style="color:#6a7684;font-size:10px"> · 幸福度 ${Math.round(s.happiness ?? 0)}</span>`),
    );
    const fav = s.foodKind === s.favFood;
    rows.push(
      row('主食', `${FOOD_NAME[s.foodKind ?? 0]}<span style="color:#6a7684"> · </span><span style="color:${fav ? '#8cdc6a' : '#e0863f'}">${fav ? '合口' : '不合口'}</span>`),
    );
    if ((s.damage ?? 0) > 0.15) {
      rows.push(row('房屋', `<span style="color:#e0863f">破损 ${Math.round((s.damage ?? 0) * 100)}%</span>`));
    }

    // ---- 历代君主：把「人」摆到界面里，历史才有主角 ----
    if (n) {
      const kings = world.agents.filter((a) => a.nation === n.id && a.role === 'king');
      if (kings.length >= 1) {
        rows.push('<div class="sep"></div>');
        rows.push(`<div class="sec-title">${kings.length > 1 ? '历代君主' : '开国之君'}</div>`);
        const recent = kings.slice(-5).reverse();
        for (const k of recent) {
          const line = k.diedYear
            ? `在位 ${Math.round(k.reign)} 年`
            : `在位 ${Math.round(k.reign)} 年 · 今上`;
          const deeds = k.deeds.slice(-2).map((d) => d.text).join('；');
          rows.push(
            `<div class="king-row">
              <div class="kr-head">
                <span class="kn">${k.name}</span>
                ${k.epithet ? `<span class="ke">「${k.epithet}」</span>` : ''}
                ${k.posthumous ? `<span class="kp">谥${k.posthumous}</span>` : ''}
                <span class="ks">${line}</span>
              </div>
              ${deeds ? `<div class="kd">${deeds}</div>` : ''}
            </div>`,
          );
        }
      }
    }
    this.el.innerHTML = `<button class="mini close" style="position:absolute;top:6px;right:6px">✕</button>${rows.join('')}`;
    this.el.hidden = false;
  }
}

function row(k: string, v: string): string {
  return `<div class="row"><span>${k}</span><span>${v}</span></div>`;
}
