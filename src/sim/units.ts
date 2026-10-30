import { Rng } from '../core/rng';
import type { World, Unit, Job } from '../core/types';

/**
 * 单位系统。
 *
 * 定位：每一个市民都是地图上真实存在的个体 —— 会在城里走动、出城干活、
 * 被拉去打仗、会死在战场上。这是从「人口是一个数字」到「看得见的人」的关键一步。
 *
 * 性能取舍：单位的总数按城池人口生成（每城 2~10 个），代表而非穷举。
 * 真正的国力仍由人口数字结算，单位负责「把世界演出来」。
 */

export const JOB_NAME: Record<Job, string> = {
  farmer: '农夫',
  wood: '樵夫',
  mine: '矿工',
  soldier: '士兵',
  priest: '祭司',
  child: '孩童',
};

/** 各职业的生成权重 */
const JOB_W: [Job, number][] = [
  ['farmer', 40],
  ['wood', 15],
  ['mine', 14],
  ['soldier', 16],
  ['priest', 6],
  ['child', 9],
];

function pickJob(rng: Rng): Job {
  const total = JOB_W.reduce((a, b) => a + b[1], 0);
  let r = rng.next() * total;
  for (const [j, w] of JOB_W) {
    r -= w;
    if (r <= 0) return j;
  }
  return 'farmer';
}

/** 一座城应该有多少个可见单位 */
export function unitsForCity(pop: number): number {
  return Math.max(2, Math.min(10, Math.round(pop / 28)));
}

/** 给一座城补足单位 */
export function populateCity(world: World, sid: number): void {
  const s = world.settlements[sid];
  if (!s || !s.alive || s.ruin) return;
  const want = unitsForCity(s.pop);
  const have = world.units.filter((u) => u.home === sid).length;
  if (have >= want) return;

  const rng = new Rng((world.seed + sid * 7919 + world.tick) ^ 0x51ed);
  for (let i = have; i < want; i++) {
    const job = pickJob(rng);
    const a = rng.next() * Math.PI * 2;
    const r = 0.5 + rng.next() * 2.2;
    world.units.push({
      id: world.units.length,
      race: s.race,
      job,
      nation: s.nation,
      home: sid,
      x: s.x + 0.5 + Math.cos(a) * r,
      y: s.y + 0.5 + Math.sin(a) * r * 0.8,
      tx: s.x + 0.5,
      ty: s.y + 0.5,
      state: 'idle',
      timer: Math.floor(rng.next() * 40),
      anim: Math.floor(rng.next() * 8),
      hp: 100,
      dir: Math.floor(rng.next() * 4),
    });
  }
}

/** 城没了，单位随之消失 */
export function clearCityUnits(world: World, sid: number): void {
  world.units = world.units.filter((u) => u.home !== sid);
}

/** 该城在城外的工作点（务农/伐木/采矿会往外跑） */
function workSpot(world: World, u: Unit, rng: Rng): { x: number; y: number } {
  const s = world.settlements[u.home];
  if (!s) return { x: u.x, y: u.y };
  const reach = u.job === 'farmer' ? 3.2 : u.job === 'wood' ? 4.0 : 3.4;
  for (let t = 0; t < 6; t++) {
    const a = rng.next() * Math.PI * 2;
    const r = reach + rng.next() * 2.4;
    const x = s.x + 0.5 + Math.cos(a) * r;
    const y = s.y + 0.5 + Math.sin(a) * r * 0.85;
    if (x < 1 || y < 1 || x > world.w - 2 || y > world.h - 2) continue;
    const ter = world.terrain[(y | 0) * world.w + (x | 0)];
    // 只在陆地上干活
    if (ter === 0 || ter === 1) continue;
    return { x, y };
  }
  return { x: s.x + 0.5 + (rng.next() - 0.5) * 2, y: s.y + 0.5 + (rng.next() - 0.5) * 2 };
}

/**
 * 每 tick 更新所有单位。
 * 状态机很简单：闲 → 走 → 干活 → 闲。战斗状态由 war 系统接管。
 */
export function updateUnits(world: World): void {
  const rng = new Rng(world.rngState ^ 0x2b17);

  for (const u of world.units) {
    // 战斗中由战斗逻辑接管移动
    if (u.state === 'fight') continue;

    u.anim++;

    if (u.timer > 0) {
      u.timer--;
    } else {
      // 决定下一步
      if (u.state === 'work') {
        u.state = 'idle';
        u.timer = 10 + rng.int(30);
      } else {
        const goWork = u.job !== 'child' && u.job !== 'priest' && rng.chance(0.55);
        const s = world.settlements[u.home];
        if (goWork && s) {
          const w = workSpot(world, u, rng);
          u.tx = w.x;
          u.ty = w.y;
          u.state = 'walk';
          u.timer = 40 + rng.int(60);
        } else if (s) {
          // 在城里转悠
          const a = rng.next() * Math.PI * 2;
          const r = 0.8 + rng.next() * 2.4;
          u.tx = s.x + 0.5 + Math.cos(a) * r;
          u.ty = s.y + 0.5 + Math.sin(a) * r * 0.8;
          u.state = 'walk';
          u.timer = 20 + rng.int(40);
        } else {
          u.timer = 20;
        }
      }
    }

    // 移动
    if (u.state === 'walk') {
      const dx = u.tx - u.x;
      const dy = u.ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.12) {
        u.state = 'work';
        u.timer = 25 + rng.int(50);
      } else {
        // 战斗中的士兵跑得快
        const spd = u.job === 'soldier' ? 0.085 : 0.055;
        u.x += (dx / d) * spd;
        u.y += (dy / d) * spd;
        // 朝向：横向优先（俯视像素人主要靠左右区分）
        if (Math.abs(dx) > Math.abs(dy)) u.dir = dx > 0 ? 2 : 1;
        else u.dir = dy > 0 ? 0 : 3;
      }
    }
  }

  world.rngState = rng.s;
}

/** 画面刷新时确保新城有单位、废城清掉单位 */
export function syncUnitsToCities(world: World): void {
  if (world.tick % 60 !== 0) return;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    populateCity(world, s.id);
  }
  // 城已废弃的单位清掉
  const dead = new Set<number>();
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) dead.add(s.id);
  }
  if (dead.size) world.units = world.units.filter((u) => !dead.has(u.home));
}
