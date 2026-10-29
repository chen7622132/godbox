import { RACES } from '../core/races';
import { WORLD_SIZES, type World, type WorldSizeKey } from '../core/types';

export interface GenesisConfig {
  size: WorldSizeKey;
  seed: number;
  landRatio: number;
  fragmentation: number;
  races: number[];
}

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

// ============ 创世 ============

export function showGenesis(
  overlay: HTMLElement,
  hasSave: boolean,
): Promise<GenesisConfig | 'load'> {
  return new Promise((resolve) => {
    const cfg: GenesisConfig = {
      size: 'medium',
      seed: Math.floor(Math.random() * 1e9),
      landRatio: 0.45,
      fragmentation: 0.35,
      races: [0, 3], // 首版默认：人类 + 兽人（最容易打出戏）
    };

    const sheet = el(`
      <div class="sheet">
        <h1>GODBOX</h1>
        <div class="sub">上帝盒子 · 创世沙盒 &nbsp;|&nbsp; 造一片大陆，撒下火种，看四族兴衰</div>

        <h2>世界</h2>
        <div class="field-row">
          <label>规模</label>
          <div class="seg" id="seg-size">
            ${(Object.keys(WORLD_SIZES) as WorldSizeKey[]).map((k) =>
              `<button data-v="${k}">${WORLD_SIZES[k].label.split(' ')[0]}</button>`).join('')}
          </div>
        </div>
        <div class="field-row">
          <label>种子</label>
          <input type="number" id="inp-seed" value="${cfg.seed}" />
          <button class="hud-btn" id="btn-rand" style="padding:5px 8px">随机</button>
        </div>
        <div class="field-row">
          <label>陆地占比</label>
          <input type="range" id="rng-land" min="25" max="60" value="45" />
          <span class="range-val" id="val-land">45%</span>
        </div>
        <div class="field-row">
          <label>破碎度</label>
          <input type="range" id="rng-frag" min="0" max="100" value="35" />
          <span class="range-val" id="val-frag">35%</span>
        </div>

        <h2>种族</h2>
        <div class="race-pick" id="race-pick">
          ${RACES.map((r) => `
            <div class="race-chip" data-race="${r.id}" style="color:${r.color}">
              <span class="dot" style="background:${r.color}"></span>${r.name}
            </div>`).join('')}
        </div>
        <p class="hintline">
          至少选 2 个异族才会打起来。兽人繁殖快、好战；精灵偏森林，战力强；矮人住山地，防御高。
        </p>

        <div class="btn-row">
          <button class="btn-primary" id="btn-genesis">开始创世</button>
          ${hasSave ? '<button class="btn-ghost" id="btn-loadstart">读取上次存档</button>' : ''}
        </div>
        <p class="hintline" style="margin-top:14px">
          操作：左键使用神迹 · 右键拖动平移 · 滚轮缩放 · 空格暂停 · 1/2/3/4 切速度<br/>
          目标：15 分钟看一整个世界从蛮荒走到统一（或灭绝）
        </p>
      </div>
    `);
    overlay.innerHTML = '';
    overlay.appendChild(sheet);
    overlay.classList.add('show');

    // 规模
    const segSize = sheet.querySelector('#seg-size') as HTMLElement;
    const syncSize = () => {
      for (const b of Array.from(segSize.querySelectorAll('button'))) {
        b.classList.toggle('on', (b as HTMLElement).dataset.v === cfg.size);
      }
    };
    segSize.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      cfg.size = b.dataset.v as WorldSizeKey;
      syncSize();
    });
    syncSize();

    // 种子
    const inpSeed = sheet.querySelector('#inp-seed') as HTMLInputElement;
    inpSeed.addEventListener('input', () => {
      cfg.seed = Math.max(1, Math.floor(Number(inpSeed.value) || 1));
    });
    (sheet.querySelector('#btn-rand') as HTMLElement).addEventListener('click', () => {
      cfg.seed = Math.floor(Math.random() * 1e9);
      inpSeed.value = String(cfg.seed);
    });

    // 滑杆
    const rngLand = sheet.querySelector('#rng-land') as HTMLInputElement;
    const valLand = sheet.querySelector('#val-land') as HTMLElement;
    rngLand.addEventListener('input', () => {
      cfg.landRatio = Number(rngLand.value) / 100;
      valLand.textContent = `${rngLand.value}%`;
    });
    const rngFrag = sheet.querySelector('#rng-frag') as HTMLInputElement;
    const valFrag = sheet.querySelector('#val-frag') as HTMLElement;
    rngFrag.addEventListener('input', () => {
      cfg.fragmentation = Number(rngFrag.value) / 100;
      valFrag.textContent = `${rngFrag.value}%`;
    });

    // 种族
    const pick = sheet.querySelector('#race-pick') as HTMLElement;
    const syncRaces = () => {
      for (const c of Array.from(pick.querySelectorAll('.race-chip'))) {
        const id = Number((c as HTMLElement).dataset.race);
        c.classList.toggle('on', cfg.races.includes(id));
      }
    };
    pick.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest('.race-chip') as HTMLElement | null;
      if (!c) return;
      const id = Number(c.dataset.race);
      if (cfg.races.includes(id)) cfg.races = cfg.races.filter((x) => x !== id);
      else cfg.races.push(id);
      syncRaces();
    });
    syncRaces();

    (sheet.querySelector('#btn-genesis') as HTMLElement).addEventListener('click', () => {
      if (cfg.races.length === 0) cfg.races = [0];
      overlay.classList.remove('show');
      overlay.innerHTML = '';
      resolve(cfg);
    });

    const btnLoad = sheet.querySelector('#btn-loadstart');
    if (btnLoad) {
      btnLoad.addEventListener('click', () => {
        overlay.classList.remove('show');
        overlay.innerHTML = '';
        resolve('load');
      });
    }
  });
}

// ============ 结算 ============

export interface EndingResult {
  restart: boolean;
}

export function showEnding(overlay: HTMLElement, world: World): Promise<EndingResult> {
  return new Promise((resolve) => {
    const st = world.stats;
    const totalPop = world.settlements
      .filter((s) => s.alive && !s.ruin)
      .reduce((a, s) => a + s.pop, 0);

    const raceStatus = RACES.map((r, i) => {
      const cities = world.settlements.filter((s) => s.alive && !s.ruin && s.race === i).length;
      const pop = world.settlements.filter((s) => s.alive && !s.ruin && s.race === i)
        .reduce((a, s) => a + s.pop, 0);
      return { r, cities, pop, peak: Math.round(st.racePeak[i]) };
    });

    const aliveRaces = raceStatus.filter((x) => x.cities > 0).length;

    // 上帝评分
    let score = 0;
    score += aliveRaces * 13;
    score += Math.min(24, Math.round(st.citiesFounded * 0.45));
    score += Math.min(22, st.warsDeclared * 2.2);
    score += Math.min(12, st.citiesDestroyed * 1.2);
    score += aliveRaces > 1 ? 8 : 0;
    score = Math.max(0, Math.min(100, Math.round(score)));

    let title = '无常的天命';
    if (st.disasters >= 6 && st.disasters > st.gifts) title = '毁灭之神';
    else if (st.gifts >= 8 && st.gifts > st.disasters * 2) title = '慈爱的造物主';
    else if (st.warsDeclared >= 8) title = '战神';
    else if (st.gifts + st.disasters <= 3) title = '沉默的旁观者';
    else if (aliveRaces >= 3 && st.warsDeclared >= 3) title = '纷争的编织者';

    const hist = st.popHistory;
    const maxPop = Math.max(1, ...hist.map((h) => h[1]));
    const bars = hist.slice(-90).map((h) => {
      const pct = Math.max(2, (h[1] / maxPop) * 100);
      return `<i style="height:${pct}%"></i>`;
    }).join('');

    const major = world.events.filter((e) => e.level >= 2).slice(-6).reverse();
    const majorHtml = major.length
      ? major.map((e) => `<div style="color:#b9c4d4;font-size:11.5px;line-height:1.7">
          <span style="color:#a98f2c">第${Math.round(e.year)}年</span> ${escapeHtml(e.text)}</div>`).join('')
      : '<div style="color:#74839a;font-size:11.5px">这个世界太安静了，没有值得记录的大事。</div>';

    const sheet = el(`
      <div class="sheet">
        <h1>本局结束</h1>
        <div class="sub">${escapeHtml(world.endReason || '世界归于沉寂')}</div>

        <div class="stat-grid">
          <div class="stat-cell"><div class="k">世界纪年</div><div class="v">${Math.round(world.year)}</div></div>
          <div class="stat-cell"><div class="k">终局人口</div><div class="v">${Math.round(totalPop)}</div></div>
          <div class="stat-cell"><div class="k">人口峰值</div><div class="v">${Math.round(st.peakPop)}</div></div>
          <div class="stat-cell"><div class="k">建国数</div><div class="v">${world.nations.length}</div></div>
          <div class="stat-cell"><div class="k">战争</div><div class="v">${st.warsDeclared}</div></div>
          <div class="stat-cell"><div class="k">战役</div><div class="v">${st.battles}</div></div>
          <div class="stat-cell"><div class="k">建城 / 毁城</div><div class="v">${st.citiesFounded} / ${st.citiesDestroyed}</div></div>
          <div class="stat-cell"><div class="k">神迹 / 灾难</div><div class="v">${st.gifts} / ${st.disasters}</div></div>
        </div>

        <h2>人口曲线</h2>
        <div class="hist">${bars || '<i style="height:2%"></i>'}</div>

        <h2>各族终局</h2>
        <div>
          ${raceStatus.map((x) => `
            <div class="row" style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
              <span style="color:${x.r.color}">${x.r.name}</span>
              <span style="color:${x.cities > 0 ? '#d7dee9' : '#6a7684'}">
                ${x.cities > 0 ? `${x.cities} 城 · ${Math.round(x.pop)} 人（峰值 ${x.peak}）` : '已灭绝'}
              </span>
            </div>`).join('')}
        </div>

        <h2>大事记</h2>
        <div>${majorHtml}</div>

        <h2>上帝评语</h2>
        <div class="verdict">
          <div style="color:#ffd447;font-weight:700;font-size:13px;letter-spacing:.1em;margin-bottom:4px">
            ${title} · 世界评分 ${score} / 100
          </div>
          ${verdictText(world, aliveRaces, score)}
        </div>

        <div class="btn-row">
          <button class="btn-primary" id="btn-again">再创一个世界</button>
          <button class="btn-ghost" id="btn-continue">回到这个世界</button>
        </div>
        <p class="hintline">「回到这个世界」会解除终局状态继续观察，但不会再触发结算。</p>
      </div>
    `);
    overlay.innerHTML = '';
    overlay.appendChild(sheet);
    overlay.classList.add('show');

    (sheet.querySelector('#btn-again') as HTMLElement).addEventListener('click', () => {
      overlay.classList.remove('show');
      overlay.innerHTML = '';
      resolve({ restart: true });
    });
    (sheet.querySelector('#btn-continue') as HTMLElement).addEventListener('click', () => {
      overlay.classList.remove('show');
      overlay.innerHTML = '';
      world.ended = false;
      world.endReason = '';
      world.overtime = true;
      resolve({ restart: false });
    });
  });
}

function verdictText(world: World, aliveRaces: number, score: number): string {
  const st = world.stats;
  const lines: string[] = [];
  if (aliveRaces <= 1) lines.push('世界被一个文明独占了——没有对手的胜利，往往也意味着停滞。');
  if (st.warsDeclared === 0) lines.push('一仗都没打起来。也许你给的陆地太宽裕了，让他们没理由争。');
  if (st.disasters > st.gifts * 2) lines.push('你更像是在做实验，而不是在养育。');
  if (st.gifts > 10) lines.push('你频繁插手，世界的走向其实是你写的剧本。');
  if (score >= 75) lines.push('这一局的故事密度很高：有人建国，有人战死，有城被焚。值得再开一局。');
  else if (score >= 45) lines.push('中规中矩的一局。下次可以试试把两族放得更近，看他们多久动手。');
  else lines.push('这一局太平淡。试试缩小地图、拉高破碎度，让生存空间变紧。');
  return lines.map((l) => `<div>· ${l}</div>`).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
