import type { World } from '../core/types';
import { RACES } from '../core/races';
import { SPEEDS } from '../core/types';

export interface HudApi {
  update: (world: World, speedIdx: number, paused: boolean) => void;
  onSpeedClick: (fn: () => void) => void;
}

export function buildHud(): HudApi {
  const yearEl = document.getElementById('hud-year') as HTMLElement;
  const popEl = document.getElementById('hud-pop') as HTMLElement;
  const natEl = document.getElementById('hud-nations') as HTMLElement;
  const speedBtn = document.getElementById('btn-speed') as HTMLButtonElement;
  const racesEl = document.getElementById('races') as HTMLElement;

  let cachedCards: HTMLElement[] = [];

  function update(world: World, speedIdx: number, paused: boolean): void {
    yearEl.textContent = `第 ${Math.round(world.year)} 年`;

    let total = 0;
    const racePop = [0, 0, 0, 0];
    const raceCities = [0, 0, 0, 0];
    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      total += s.pop;
      racePop[s.race] += s.pop;
      raceCities[s.race]++;
    }
    const natCount = world.nations.filter((n) => n.alive).length;
    popEl.textContent = `人口 ${Math.round(total)}`;
    natEl.textContent = `国家 ${natCount}`;

    if (paused) {
      speedBtn.textContent = '❚❚ 暂停';
      speedBtn.classList.add('active');
    } else {
      speedBtn.textContent = `▶ ${SPEEDS[speedIdx]}x`;
      speedBtn.classList.remove('active');
    }

    // 种族卡片
    if (cachedCards.length === 0) {
      for (const r of RACES) {
        const c = document.createElement('div');
        c.className = 'race-card';
        c.style.color = r.color;
        c.innerHTML = `<div class="rn">${r.name}</div><div class="rp">人口 <b>0</b></div><div class="rp">城 <b>0</b></div><div class="rp nm"></div>`;
        racesEl.appendChild(c);
        cachedCards.push(c);
      }
    }
    for (let i = 0; i < 4; i++) {
      const c = cachedCards[i];
      if (!c) continue;
      const alive = raceCities[i] > 0;
      c.style.opacity = alive ? '1' : '0.32';
      const popB = c.querySelectorAll('b')[0] as HTMLElement;
      const cityB = c.querySelectorAll('b')[1] as HTMLElement;
      popB.textContent = String(Math.round(racePop[i]));
      cityB.textContent = String(raceCities[i]);
      const nm = c.querySelector('.nm') as HTMLElement;
      const nations = world.nations.filter((n) => n.alive && n.race === i);
      nm.textContent = nations.length
        ? nations.map((n) => n.name).slice(0, 2).join('·')
        : raceCities[i] > 0 ? '未建国' : '—';
    }
  }

  return {
    update,
    onSpeedClick(fn) {
      speedBtn.addEventListener('click', fn);
    },
  };
}
