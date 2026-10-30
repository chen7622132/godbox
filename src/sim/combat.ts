import { Rng } from '../core/rng';
import type { World, Unit, Army, Spark } from '../core/types';

/**
 * 近身战内核。
 *
 * 设计原则：所有伤害都由「看得见的动作」产生 ——
 * 近战兵真的贴到 0.6 格内才挥刀，弓手真的放出一支飞过屏幕的箭。
 * 不存在「判定时扣血、画面随便演」的两套账。
 */

const CELL = 2;
const MELEE_REACH = 0.62;
const MELEE_DMG = 5;
const MELEE_CD = 26; // tick：一刀一刀来，太快就成了「瞬间蒸发」
const ARCHER_CD = 26;
const ARCHER_DMG = 6;
const ARCHER_RANGE = 7.5;
const ARROW_STEP = 0.34;

/** 复用的空间网格（2 格一格），避免每 tick new Map */
const grid = new Map<number, Unit[]>();

function gkey(gx: number, gy: number): number {
  return gy * 8192 + gx;
}

function buildGrid(world: World): void {
  for (const arr of grid.values()) arr.length = 0;
  for (const u of world.units) {
    if (u.job !== 'soldier') continue;
    const k = gkey((u.x / CELL) | 0, (u.y / CELL) | 0);
    let cell = grid.get(k);
    if (!cell) {
      cell = [];
      grid.set(k, cell);
    }
    cell.push(u);
  }
}

/** 找最近的非友军单位（只在自己周围 1~2 格范围内找，远的不关心） */
export function nearestEnemy(world: World, u: Unit, maxD: number): Unit | null {
  const cx = (u.x / CELL) | 0;
  const cy = (u.y / CELL) | 0;
  const span = Math.ceil(maxD / CELL);
  let best: Unit | null = null;
  let bd = maxD * maxD;
  for (let gy = cy - span; gy <= cy + span; gy++) {
    for (let gx = cx - span; gx <= cx + span; gx++) {
      const cell = grid.get(gkey(gx, gy));
      if (!cell) continue;
      for (const e of cell) {
        if (e.nation === u.nation) continue;
        if (e.hp <= 0) continue;
        const dx = e.x - u.x;
        const dy = e.y - u.y;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
    }
  }
  return best;
}

/** 在某个坐标附近找一个敌方单位（箭矢命中用） */
export function enemyAt(world: World, x: number, y: number, nation: number, r: number): Unit | null {
  const cx = (x / CELL) | 0;
  const cy = (y / CELL) | 0;
  const span = Math.ceil(r / CELL);
  let best: Unit | null = null;
  let bd = r * r;
  for (let gy = cy - span; gy <= cy + span; gy++) {
    for (let gx = cx - span; gx <= cx + span; gx++) {
      const cell = grid.get(gkey(gx, gy));
      if (!cell) continue;
      for (const e of cell) {
        if (e.nation === nation || e.hp <= 0) continue;
        const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
    }
  }
  return best;
}

/** 迸一把火花 */
export function addSparks(world: World, x: number, y: number, n: number, kind: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (world.sparks.length >= 360) break;
    world.sparks.push({
      x,
      y,
      vx: (rng.next() - 0.5) * 1.5,
      vy: (rng.next() - 0.5) * 1.5 - 0.25,
      life: 8 + rng.int(7),
      max: 15,
      kind,
    });
  }
}

/** 箭矢池：上限 200 支，射完立刻回收 */
function spawnArrow(world: World, from: Unit, to: Unit): void {
  let a = world.arrows.find((x) => !x.active);
  if (!a) {
    if (world.arrows.length >= 200) return;
    a = { x: 0, y: 0, vx: 0, vy: 0, life: 0, nation: 0, race: 0, target: -1, active: false };
    world.arrows.push(a);
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.max(0.001, Math.hypot(dx, dy));
  a.x = from.x;
  a.y = from.y - 0.18; // 从胸口放出去，不是从脚底
  a.vx = (dx / d) * ARROW_STEP;
  a.vy = (dy / d) * ARROW_STEP;
  a.life = Math.min(30, Math.ceil(d / ARROW_STEP) + 2);
  a.nation = from.nation;
  a.race = from.race;
  a.target = to.id;
  a.active = true;
  from.swing = 8;
}

/** 一支军队开局时的编制，用来算兵力条 */
export function armyInitial(a: Army): number {
  return Math.max(1, a.units.length);
}

/**
 * 每 tick 推一次战斗。
 * 顺序：建网格 → 士兵决策（近战贴脸 / 弓手放箭）→ 箭飞行命中 → 粒子与尸体老化。
 */
export function updateCombat(world: World): void {
  if (!world.arrows) world.arrows = [];
  if (!world.sparks) world.sparks = [];
  if (!world.corpses) world.corpses = [];

  const fighting = world.armies.some((a) => a.state === 'clash');
  if (!fighting && !world.arrows.some((a) => a.active) && !world.sparks.length) {
    if (world.corpses.length) for (const c of world.corpses) c.age++;
    return;
  }

  const rng = new Rng(world.rngState ^ 0x5f3d);
  buildGrid(world);

  const armyOf = new Map<number, Army>();
  for (const a of world.armies) armyOf.set(a.id, a);

  const dead: Unit[] = [];

  for (const u of world.units) {
    if (u.job !== 'soldier' || u.army === undefined) continue;
    const a = armyOf.get(u.army);
    if (!a || a.state !== 'clash') continue;

    const reach = u.role === 'archer' ? ARCHER_RANGE : MELEE_REACH + 1.6;
    const enemy = nearestEnemy(world, u, reach);

    if (!enemy) {
      // 没有敌人：站定，等下一波
      u.swing = Math.max(0, (u.swing ?? 0) - 1);
      continue;
    }

    const dx = enemy.x - u.x;
    const dy = enemy.y - u.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    u.fx = dx / d;
    u.fy = dy / d;
    u.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3);

    if (u.role === 'archer') {
      // 弓手：不往前挤，一箭一箭地放；被贴脸就往后挪半步（弓手不该被抱住打）
      u.state = 'fight';
      if (d < 1.15) {
        u.x -= (dx / d) * 0.05;
        u.y -= (dy / d) * 0.05;
      } else if (world.tick % ARCHER_CD === u.id % ARCHER_CD) {
        spawnArrow(world, u, enemy);
      }
    } else if (u.role === 'general') {
      // 将军：护旗，只在敌人贴脸时才拔刀
      if (d < MELEE_REACH + 0.4) {
        u.state = 'fight';
        if (world.tick % MELEE_CD === u.id % MELEE_CD) {
          enemy.hp -= MELEE_DMG + rng.int(5);
          enemy.flash = world.tick + 8;
          u.swing = 5;
          addSparks(world, enemy.x, enemy.y - 0.2, 3, 1, rng);
          if (enemy.hp <= 0) dead.push(enemy);
        }
      }
    } else {
      // 近战：贴上去，够得着就砍
      if (d > MELEE_REACH) {
        u.state = 'walk';
        const step = 0.075;
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
      } else {
        u.state = 'fight';
        if (world.tick % MELEE_CD === u.id % MELEE_CD) {
          enemy.hp -= MELEE_DMG + rng.int(7);
          enemy.flash = world.tick + 8;
          u.swing = 5;
          addSparks(world, enemy.x, enemy.y - 0.22, 6, rng.chance(0.42) ? 1 : 0, rng);
          if (enemy.hp <= 0) dead.push(enemy);
        }
      }
    }
    if (u.swing) u.swing = Math.max(0, u.swing - 1);
  }

  // ---- 箭飞行 ----
  for (const ar of world.arrows) {
    if (!ar.active) continue;
    ar.x += ar.vx;
    ar.y += ar.vy;
    ar.life--;
    if (ar.life <= 0) {
      ar.active = false;
      addSparks(world, ar.x, ar.y, 2, 2, rng);
      continue;
    }
    // 命中：一路上碰到的第一个敌人
    const hit = enemyAt(world, ar.x, ar.y, ar.nation, 0.42);
    if (hit) {
      hit.hp -= ARCHER_DMG + rng.int(6);
      hit.flash = world.tick + 8;
      addSparks(world, hit.x, hit.y - 0.2, 5, 1, rng);
      ar.active = false;
      if (hit.hp <= 0) dead.push(hit);
    }
  }

  // ---- 收尸 ----
  if (dead.length) {
    const set = new Set(dead.map((d) => d.id));
    for (const d of dead) {
      world.corpses.push({ x: d.x, y: d.y, race: d.race, nation: d.nation, dir: d.dir, age: 0 });
      const a = d.army !== undefined ? world.armies.find((x) => x.id === d.army) : undefined;
      if (a) {
        const i = a.units.indexOf(d.id);
        if (i >= 0) a.units.splice(i, 1);
        a.strength = Math.max(0, Math.min(1, a.units.length / Math.max(1, a.initial)));
        a.morale = a.strength;
      }
    }
    world.units = world.units.filter((u) => !set.has(u.id));
    if (world.corpses.length > 260) world.corpses.splice(0, world.corpses.length - 260);
  }

  // ---- 火花 ----
  for (let i = world.sparks.length - 1; i >= 0; i--) {
    const s: Spark = world.sparks[i];
    s.x += s.vx * 0.06;
    s.y += s.vy * 0.06;
    s.vy += 0.045;
    s.life--;
    if (s.life <= 0) world.sparks.splice(i, 1);
  }

  // ---- 尸体老化 ----
  for (let i = world.corpses.length - 1; i >= 0; i--) {
    world.corpses[i].age++;
    if (world.corpses[i].age > 900) world.corpses.splice(i, 1);
  }

  world.rngState = rng.s;
}
