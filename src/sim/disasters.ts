import { Rng } from '../core/rng';
import { logEvent } from '../core/events';
import { T, IS_LAND, type World } from '../core/types';
import { killSettlement } from './simulation';

const rng = new Rng(7);

/** 可燃地形 */
function flammable(t: number): boolean {
  return t === T.Forest || t === T.Grass || t === T.Swamp;
}

// ============ 点火 ============

export function ignite(world: World, cx: number, cy: number, radius: number): void {
  const { w, h, terrain, fire } = world;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = y * w + x;
      if (!flammable(terrain[i])) continue;
      fire[i] = 140 + rng.int(60);
      n++;
    }
  }
  if (n > 0) world.hasFire = true;
  world.stats.disasters++;
  logEvent(world, 'disaster', `天火降下，${n} 格土地燃起（${world.year} 年）`, -1, 1);
}

// ============ 瘟疫 ============

export function startPlague(world: World, cx: number, cy: number, radius: number): void {
  const { w, h, terrain, plague } = world;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = y * w + x;
      if (!IS_LAND[terrain[i]]) continue;
      plague[i] = 200;
      n++;
    }
  }
  if (n > 0) world.hasPlague = true;
  world.stats.disasters++;
  logEvent(world, 'plague', `瘟疫在世上蔓延，${n} 格土地被污染`, -1, 2);
}

// ============ 地震 ============

export function earthquake(world: World, cx: number, cy: number, radius: number): void {
  const { w, h, terrain, fert } = world;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= w - 1) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = y * w + x;
      const t = terrain[i];
      const r = rng.next();
      if (t === T.Grass || t === T.Forest) {
        if (r < 0.32) terrain[i] = T.Hill;
        else if (r < 0.42) terrain[i] = T.Sand;
        fert[i] = Math.max(0, fert[i] - 60);
      } else if (t === T.Hill) {
        if (r < 0.3) terrain[i] = T.Mountain;
        fert[i] = Math.max(0, fert[i] - 40);
      } else if (t === T.Mountain || t === T.Snow) {
        if (r < 0.12) terrain[i] = T.Hill;
      }
    }
  }
  damageSettlements(world, cx, cy, radius, 0.45, '被地震摧毁');
  world.stats.disasters++;
  logEvent(world, 'disaster', '大地震裂，山峦倾覆', -1, 2);
}

// ============ 陨石 ============

export function meteor(world: World, cx: number, cy: number, radius: number): void {
  const { w, h, terrain, fert, fire } = world;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= w - 1) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const i = y * w + x;
      const d = Math.sqrt(d2) / radius;
      if (d < 0.4) {
        terrain[i] = rng.chance(0.55) ? T.Water : T.Deep;
        fert[i] = 0;
      } else if (d < 0.75) {
        terrain[i] = rng.chance(0.5) ? T.Sand : T.Hill;
        fert[i] = Math.max(0, fert[i] - 80);
        if (flammable(terrain[i]) && rng.chance(0.3)) { fire[i] = 160; world.hasFire = true; }
      } else if (flammable(terrain[i]) && rng.chance(0.35)) {
        fire[i] = 120;
        world.hasFire = true;
      }
    }
  }
  damageSettlements(world, cx, cy, radius * 0.8, 0.9, '被天外火球抹平');
  world.stats.disasters++;
  logEvent(world, 'disaster', '天外火球坠落，砸出一个巨坑', -1, 2);
}

// ============ 洪水 ============

export function flood(world: World, cx: number, cy: number, radius: number): void {
  const { w, h, terrain, fert } = world;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= w - 1) continue;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = y * w + x;
      if (IS_LAND[terrain[i]] && rng.chance(0.8)) {
        terrain[i] = T.Water;
        fert[i] = 40;
      }
    }
  }
  damageSettlements(world, cx, cy, radius, 0.85, '被洪水吞没');
  world.stats.disasters++;
  logEvent(world, 'disaster', '海啸与大洪水淹没了大地', -1, 2);
}

/** 伤害半径内的聚落 */
function damageSettlements(
  world: World, cx: number, cy: number, radius: number, severity: number, cause: string,
): void {
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d > radius) continue;
    const falloff = 1 - d / Math.max(1, radius);
    s.pop *= 1 - severity * falloff;
    if (s.pop < 12) killSettlement(world, s, cause);
  }
}

// ============ 蔓延（每 3 tick） ============

export function updateFire(world: World): void {
  if (!world.hasFire) return;
  rng.s = world.rngState;
  const { w, h, terrain, fire, fert } = world;
  let alive = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (fire[i] === 0) continue;
      alive++;
      // 向邻格蔓延
      if (fire[i] > 40) {
        for (let k = 0; k < 4; k++) {
          const j = i + [-1, 1, -w, w][k];
          if (fire[j] > 0) continue;
          if (!flammable(terrain[j])) continue;
          // 下风/干旱更易着
          if (rng.chance(0.11 * (fert[j] / 255 + 0.5))) {
            fire[j] = 120 + rng.int(60);
          }
        }
      }
      fire[i] = fire[i] > 26 ? fire[i] - 26 : 0;
      // 烧尽：森林变草原，肥力下降
      if (fire[i] === 0) {
        if (terrain[i] === T.Forest) terrain[i] = T.Grass;
        fert[i] = Math.max(0, fert[i] - 55);
      }
    }
  }
  if (alive === 0) world.hasFire = false;
  world.rngState = rng.s;

  // 火烧到城市
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const i = s.y * w + s.x;
    if (fire[i] > 80 && s.pop > 0 && rng.chance(0.35)) {
      s.pop *= 0.9;
      if (s.pop < 10) killSettlement(world, s, '被大火焚毁');
    }
  }
}

export function updatePlague(world: World): void {
  if (!world.hasPlague) return;
  rng.s = world.rngState;
  const { w, h, terrain, plague } = world;
  let alive = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (plague[i] === 0) continue;
      alive++;
      if (plague[i] > 50) {
        for (let k = 0; k < 4; k++) {
          const j = i + [-1, 1, -w, w][k];
          if (plague[j] > 0) continue;
          if (!IS_LAND[terrain[j]]) continue;
          if (rng.chance(0.05)) plague[j] = 170;
        }
      }
      plague[i] = plague[i] > 12 ? plague[i] - 12 : 0;
    }
  }
  if (alive === 0) world.hasPlague = false;
  world.rngState = rng.s;
}

/** 读档或外部修改后重建 hasFire / hasPlague */
export function refreshHazards(world: World): void {
  world.hasFire = world.fire.some((v) => v > 0);
  world.hasPlague = world.plague.some((v) => v > 0);
}
