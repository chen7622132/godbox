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
    const r = 0.5 + rng.next() * 3.8;
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

  const fights = world.battles ?? [];
  for (const u of world.units) {
    // 站在战场上就打 —— 不管它原本在干什么
    if (u.job === 'soldier' && fights.length) {
      for (const bg of fights) {
        if (Math.hypot(u.x - bg.x, u.y - bg.y) < 7) {
          u.state = 'fight';
          u.timer = 2;
          break;
        }
      }
    }
    if (u.state === 'fight') {
      // 交战：原地小幅度抖动，像在互砍
      u.anim++;
      u.x += (rng.next() - 0.5) * 0.05;
      u.y += (rng.next() - 0.5) * 0.05;
      continue;
    }

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

// ============ 战场 ============

/** 一支正在交战的部队 */
export interface BattleGroup {
  /** 攻方单位 id */
  attackers: number[];
  /** 守方单位 id */
  defenders: number[];
  /** 战场中心 */
  x: number;
  y: number;
  /** 结束 tick */
  until: number;
  /** 败方国家 id（收场时这些士兵倒下） */
  loserNation: number;
}

/**
 * 在一座城下生成一场可视化的战斗。
 *
 * 关键取舍：胜负早已由战役数值判定，这里只负责「把它演出来」——
 * 攻方从城外冲进去，守方在城里迎击，两边真的短兵相接、真的倒下。
 */
export function spawnBattle(
  world: World,
  target: number,
  attackerRace: number,
  attackerNation: number,
  decideWin: boolean,
): void {
  const city = world.settlements[target];
  if (!city) return;

  const rng = new Rng((world.tick * 131 + target * 17) ^ 0x7c3a);
  const nAtk = 7 + rng.int(6);
  const nDef = 5 + rng.int(5);

  // 攻方：从城的一侧冲进来
  const ang = rng.next() * Math.PI * 2;
  for (let i = 0; i < nAtk; i++) {
    const a = ang + (rng.next() - 0.5) * 0.8;
    const r = 4.5 + rng.next() * 2;
    world.units.push({
      id: world.units.length,
      race: attackerRace,
      job: 'soldier',
      nation: attackerNation,
      home: target,
      x: city.x + 0.5 + Math.cos(a) * r,
      y: city.y + 0.5 + Math.sin(a) * r * 0.8,
      tx: city.x + 0.5,
      ty: city.y + 0.5,
      state: 'fight',
      timer: 90,
      anim: rng.int(8),
      hp: 100,
      dir: 2,
    });
  }

  // 守方：在城内列阵
  for (let i = 0; i < nDef; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 0.6 + rng.next() * 1.8;
    world.units.push({
      id: world.units.length,
      race: city.race,
      job: 'soldier',
      nation: city.nation,
      home: target,
      x: city.x + 0.5 + Math.cos(a) * r,
      y: city.y + 0.5 + Math.sin(a) * r * 0.8,
      tx: city.x + 0.5,
      ty: city.y + 0.5,
      state: 'fight',
      timer: 90,
      anim: rng.int(8),
      hp: 100,
      dir: 0,
    });
  }

  world.battles = world.battles ?? [];
  world.battles.push({
    attackers: [],
    defenders: [],
    x: city.x,
    y: city.y,
    until: world.tick + 110,
    loserNation: decideWin ? city.nation : attackerNation,
  });
}

/** 战斗结束：败方单位倒下 */
export function endBattles(world: World): void {
  if (!world.battles?.length) return;
  world.battles = world.battles.filter((bg) => {
    if (world.tick < bg.until) return true;
    // 败方倒在战场上，胜方留下驻守
    world.units = world.units.filter((u) => {
      if (u.job !== 'soldier') return true;
      const d = Math.hypot(u.x - bg.x, u.y - bg.y);
      if (d > 7) return true;
      return u.nation !== bg.loserNation;
    });
    return false;
  });
}

// ============ 行军 ============

/** 一支正在路上的军队 */
export interface March {
  /** 出征国 */
  nation: number;
  /** 出发城 */
  from: number;
  /** 目标城 */
  to: number;
  /** 随军单位 id */
  units: number[];
  /** 预计抵达 tick */
  arrive: number;
  /** 是否已经打过（防重复） */
  resolved: boolean;
}

/**
 * 发兵：在出发城生成一队士兵，朝目标城开拔。
 *
 * 这是「看得见的战争」的关键 —— 之前是判定时凭空在城下冒出一群人，
 * 现在玩家能看着一队人从这座城走出去、穿过原野、围到那座城下。
 */
export function launchMarch(world: World, fromCity: number, toCity: number, nation: number, race: number): March | null {
  const a = world.settlements[fromCity];
  const b = world.settlements[toCity];
  if (!a || !b) return null;

  const rng = new Rng((world.tick * 7919 + toCity * 131) ^ 0x3ab1);
  const n = 6 + rng.int(8);
  const ids: number[] = [];

  // 排成一列横队：垂直行军方向排开，才看得出「一支兵」
  const dx0 = b.x - a.x;
  const dy0 = b.y - a.y;
  const dl = Math.max(0.001, Math.hypot(dx0, dy0));
  const fx = dx0 / dl;
  const fy = dy0 / dl;
  const px = -fy;
  const py = fx;

  for (let i = 0; i < n; i++) {
    const side = (i - (n - 1) / 2) * 0.42;
    const back = (i % 2) * 0.3;
    const id = world.units.length;
    world.units.push({
      id,
      race,
      job: 'soldier',
      nation,
      home: fromCity,
      x: a.x + 0.5 + fx * (0.8 - back) + px * side,
      y: a.y + 0.5 + fy * (0.8 - back) + py * side,
      tx: b.x + 0.5,
      ty: b.y + 0.5,
      state: 'walk',
      timer: 400,
      anim: rng.int(8),
      hp: 100,
      dir: 2,
    });
    ids.push(id);
  }

  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return {
    nation,
    from: fromCity,
    to: toCity,
    units: ids,
    arrive: world.tick + Math.max(30, Math.round(dist * 2.2)),
    resolved: false,
  };
}

/** 行军推进：把军队朝目标城挪，到了就返回 true（由战役逻辑接管） */
export function advanceMarch(world: World, m: March): boolean {
  const target = world.settlements[m.to];
  if (!target) return true;
  if (world.tick >= m.arrive) return true;

  const alive = new Set(world.units.map((u) => u.id));
  for (const id of m.units) {
    if (!alive.has(id)) continue;
    const u = world.units.find((x) => x.id === id);
    if (!u) continue;
    u.tx = target.x + 0.5;
    u.ty = target.y + 0.5;
    u.state = 'walk';
    if (u.job === 'soldier') u.timer = 400;
  }
  return false;
}

/** 抵达后收编：把行军的士兵改成守城/冲锋状态 */
export function arriveMarch(world: World, m: March, attackerWins: boolean): void {
  const alive = new Set(world.units.map((u) => u.id));
  const px = world.settlements[m.to]?.x ?? 0;
  const py = world.settlements[m.to]?.y ?? 0;
  for (const id of m.units) {
    if (!alive.has(id)) continue;
    const u = world.units.find((x) => x.id === id);
    if (!u) continue;
    if (attackerWins) {
      u.state = 'idle';
      u.timer = 60;
    } else {
      // 打输了：这批人从地图上撤走（败退）
      u.x = px + (u.x - px) * 2.4;
      u.y = py + (u.y - py) * 2.4;
      u.state = 'walk';
      u.tx = u.x + (u.x - px) * 3;
      u.ty = u.y + (u.y - py) * 3;
    }
  }
}
