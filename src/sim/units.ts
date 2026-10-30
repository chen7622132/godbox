import { Rng } from '../core/rng';
import type { World, Unit, Job, Army, UnitRole } from '../core/types';

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
  let nid = nextUnitId(world);
  for (let i = have; i < want; i++) {
    const job = pickJob(rng);
    const a = rng.next() * Math.PI * 2;
    const r = 0.5 + rng.next() * 3.8;
    world.units.push({
      id: nid++,
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

/**
 * 建筑占位检测。
 * 之前的小人可以直接穿过墙体、站在屋顶上 —— 因为「城」只是一堆画出来的像素，
 * 模拟层根本不知道哪里有墙。现在渲染层会把自己算出来的建筑位置写回 Settlement.spots，
 * 单位移动时据此让路，人和房子才不会互相穿过去。
 */
function blockedAt(world: World, x: number, y: number): boolean {
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    if (!s.spots || !s.spots.length) continue;
    if (x < s.x - 5.5 || x > s.x + 5.5 || y < s.y - 5.5 || y > s.y + 5.5) continue;
    for (const f of s.spots) {
      const dx = x - f.x;
      const dy = y - f.y;
      // 椭圆而不是圆：屋顶是往上画的，视觉上「站在屋顶上」的其实是站在房子上方那一格。
      // 所以竖直方向的禁行范围要比横向大得多。
      // 选落脚点时用「大禁区」：连屋顶上方那片视觉区域也避开，
      // 否则人会停在屋顶正上方，看起来像站在屋顶上。
      const ex = dx / (f.r + 0.1);
      const ey = (dy + 0.42) / (f.r * 1.65);
      if (ex * ex + ey * ey < 1) return true;
    }
  }
  return false;
}

/** 如果正踩在墙上，就沿最近的空位推出去（不是瞬移，是「侧身让开」） */
function pushOutOfWalls(world: World, u: Unit): void {
  for (const s of world.settlements) {
    if (!s.alive || s.ruin || !s.spots?.length) continue;
    if (Math.abs(u.x - s.x) > 5.5 || Math.abs(u.y - s.y) > 5.5) continue;
    for (const f of s.spots) {
      const dx = u.x - f.x;
      const dy = u.y - f.y;
      const ex = dx / (f.r + 0.04);
      const ey = dy / (f.r + 0.04);
      if (ex * ex + ey * ey >= 1) continue;
      const k = 1 / Math.sqrt(Math.max(ex * ex + ey * ey, 0.0001));
      u.x = f.x + dx * k;
      u.y = f.y + dy * k;
      return;
    }
  }
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
    // 随军单位由 updateArmies 接管队形，这里不插手
    if (u.army !== undefined) continue;
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
          // 在城里转悠：挑一个不踩着房子的落脚点
          let tx = s.x + 0.5;
          let ty = s.y + 0.5;
          for (let t = 0; t < 6; t++) {
            const a = rng.next() * Math.PI * 2;
            const r = 0.9 + rng.next() * 2.6;
            const cx = s.x + 0.5 + Math.cos(a) * r;
            const cy = s.y + 0.5 + Math.sin(a) * r * 0.8;
            if (!blockedAt(world, cx, cy)) {
              tx = cx;
              ty = cy;
              break;
            }
          }
          u.tx = tx;
          u.ty = ty;
          u.state = 'walk';
          u.timer = 20 + rng.int(40);
        } else {
          u.timer = 20;
        }
      }
    }

    // 站在墙里就侧身让开（战斗中的士兵例外：他们要往前冲）
    if (world.settlements.length) pushOutOfWalls(world, u);

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

  // 战后复员：士兵打完仗会留在原地，久了会堆成一片「僵尸驻军」。
  // 这里按城的人口配额清掉超额的那部分（只清已不属于任何军队的散兵）。
  if (world.tick % 120 !== 0) return;
  const perCity = new Map<number, number[]>();
  for (const u of world.units) {
    if (u.army !== undefined) continue;
    let list = perCity.get(u.home);
    if (!list) {
      list = [];
      perCity.set(u.home, list);
    }
    list.push(u.id);
  }
  const cut = new Set<number>();
  for (const [sid, ids] of perCity) {
    const sc = world.settlements[sid];
    const cap = sc ? unitsForCity(sc.pop) + 4 : 4;
    if (ids.length <= cap) continue;
    // 优先遣散离城最远的
    const cx = sc ? sc.x + 0.5 : 0;
    const cy = sc ? sc.y + 0.5 : 0;
    const byId = new Map(world.units.map((u) => [u.id, u]));
    ids.sort((ia, ib) => {
      const ua = byId.get(ia);
      const ub = byId.get(ib);
      const da = ua ? Math.hypot(ua.x - cx, ua.y - cy) : 0;
      const db = ub ? Math.hypot(ub.x - cx, ub.y - cy) : 0;
      return db - da;
    });
    for (let i = 0; i < ids.length - cap; i++) cut.add(ids[i]);
  }
  if (cut.size) world.units = world.units.filter((u) => !cut.has(u.id));
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
 * 登记一场可视化战斗。
 *
 * v2 的关键变化：这里不再「凭空生成两拨人」——人是 formArmy 从城里走过来的，
 * 这个函数只做两件事：把城下所有士兵切成交战状态，记一个收场时间。
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

  const cx = city.x + 0.5;
  const cy = city.y + 0.5;
  for (const u of world.units) {
    if (u.job !== 'soldier') continue;
    if (Math.hypot(u.x - cx, u.y - cy) > 8) continue;
    u.state = 'fight';
    u.timer = 120;
    u.swing = 8;
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

// ============ 军队（v2 方阵）============

/** 队列间距（格）：5 列 × 0.34 ≈ 1.4 格宽，加上人本身约 1.7 格，正好是「1.5~2 格簇拥」 */
export const ARMY_SPACING = 0.26;
/** 一排站几个人 */
export const ARMY_COLS = 6;

/** 每个阵位到阵心的距离上限（判断队形是否散掉） */
function nextUnitId(world: World): number {
  let n = 0;
  for (const u of world.units) if (u.id >= n) n = u.id + 1;
  return n;
}

/**
 * 组成一支军队：将军居中扛旗，近战在前两排，弓手在后一排。
 *
 * 之所以要「生成时就排好」，是因为队形一旦在生成时确定，之后每 tick 只要
 * 让每个人收敛回自己的位置，整支军队看上去就是一块会呼吸的板 ——
 * 而不是一群各自乱走的散兵。
 */
export function formArmy(
  world: World,
  fromCity: number,
  toCity: number,
  nation: number,
  race: number,
): Army | null {
  const home = world.settlements[fromCity];
  const target = world.settlements[toCity];
  if (!home || !target) return null;

  const rng = new Rng((world.tick * 7919 + toCity * 131) ^ 0x3ab1);
  const total = 26 + rng.int(8); // 26~33 人：6 列 × 5 排 ≈ 1.5×1.3 格的一块铁板
  const nArcher = Math.max(4, Math.round(total * 0.35));
  const nMelee = Math.max(3, total - nArcher);

  const dx = target.x - home.x;
  const dy = target.y - home.y;
  const dist = Math.max(0.001, Math.hypot(dx, dy));
  const fx = dx / dist;
  const fy = dy / dist;
  const px = -fy;
  const py = fx;

  const cx = home.x + 0.5 + fx * 1.3;
  const cy = home.y + 0.5 + fy * 1.3;

  let nid = nextUnitId(world);
  const armyId = (world.tick & 0xffff) * 64 + (fromCity & 0x3f);
  const units: number[] = [];

  const add = (role: UnitRole, side: number, back: number, hp: number): number => {
    const id = nid++;
    world.units.push({
      id,
      race,
      job: 'soldier',
      nation,
      home: fromCity,
      x: cx + px * side + fx * back,
      y: cy + py * side + fy * back,
      tx: cx,
      ty: cy,
      state: 'walk',
      timer: 600,
      anim: rng.int(8),
      hp,
      dir: Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 2 : 1) : (fy > 0 ? 0 : 3),
      role,
      army: armyId,
      fx,
      fy,
      ax: side,
      ay: back,
    });
    units.push(id);
    return id;
  };

  // 近战：将军前方的两排
  let slot = 0;
  for (let i = 0; i < nMelee; i++, slot++) {
    const row = Math.floor(slot / ARMY_COLS);
    const col = slot % ARMY_COLS;
    add('melee', (col - (ARMY_COLS - 1) / 2) * ARMY_SPACING, -ARMY_SPACING * (row + 1), 100);
  }
  // 弓手：将军后方的排
  for (let i = 0; i < nArcher; i++) {
    const row = Math.floor(i / ARMY_COLS);
    const col = i % ARMY_COLS;
    add('archer', (col - (ARMY_COLS - 1) / 2) * ARMY_SPACING, ARMY_SPACING * (row + 1), 70);
  }
  // 将军：阵心，扛旗
  const gid = add('general', 0, 0, 180);

  return {
    id: armyId,
    nation,
    race,
    kind: 'attack',
    initial: total + 1,
    from: fromCity,
    to: toCity,
    general: gid,
    units,
    x: cx,
    y: cy,
    fx,
    fy,
    state: 'march',
    strength: 1,
    morale: 1,
    arrive: world.tick + Math.max(26, Math.round(dist * 8)),
    timer: 0,
    resolved: false,
    retries: 0,
  };
}

/**
 * 每 tick 推进所有军队。
 * 阵心朝目标走，成员朝自己的阵位收敛 —— 队形因此不会散。
 */
export function updateArmies(world: World): void {
  if (!world.armies?.length) return;
  const byId = new Map<number, Unit>();
  for (const u of world.units) byId.set(u.id, u);

  for (const a of world.armies) {
    if (a.resolved) continue;
    a.units = a.units.filter((id) => byId.has(id));

    if (a.state === 'march') {
      const t = world.settlements[a.to];
      if (t) {
        const dx = t.x + 0.5 - a.x;
        const dy = t.y + 0.5 - a.y;
        const d = Math.hypot(dx, dy);
        if (d <= 3.2) {
          a.state = 'clash';
        } else {
          const spd = 0.115;
          a.x += (dx / d) * spd;
          a.y += (dy / d) * spd;
          a.fx = dx / d;
          a.fy = dy / d;
        }
      }
    } else if (a.state === 'retreat') {
      // 败退：整队往回跑，阵型不散 —— 玩家看到的应该是「潮水退去」，不是「人跑了」
      const home = world.settlements[a.from];
      if (home) {
        const dx = home.x + 0.5 - a.x;
        const dy = home.y + 0.5 - a.y;
        const d = Math.hypot(dx, dy);
        if (d <= 2.6) {
          a.state = 'rally';
          a.timer = world.tick + 150;
        } else {
          const spd = 0.135;
          a.x += (dx / d) * spd;
          a.y += (dy / d) * spd;
          a.fx = dx / d;
          a.fy = dy / d;
        }
      } else {
        a.resolved = true;
      }
    }

    const px = -a.fy;
    const py = a.fx;

    // 交战中不再把士兵拉回阵位 —— 否则「冲锋力」和「归位力」互相抵消，
    // 两军会僵持在半格之外互相瞪眼（这是第一版真实踩到的坑）。
    if (a.state === 'clash') {
      for (const id of a.units) {
        const u = byId.get(id);
        if (!u) continue;
        u.anim++;
      }
      continue;
    }

    for (const id of a.units) {
      const u = byId.get(id);
      if (!u) continue;
      const tx = a.x + px * (u.ax ?? 0) + a.fx * (u.ay ?? 0);
      const ty = a.y + py * (u.ax ?? 0) + a.fy * (u.ay ?? 0);
      const dx = tx - u.x;
      const dy = ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.015) {
        const k = Math.min(0.34, 0.2 + d * 0.4);
        u.x += dx * k;
        u.y += dy * k;
      }
      u.fx = a.fx;
      u.fy = a.fy;
      u.anim++;
      if (u.state !== 'fight') u.state = 'walk';
      if (Math.abs(a.fx) > Math.abs(a.fy)) u.dir = a.fx > 0 ? 2 : 1;
      else u.dir = a.fy > 0 ? 0 : 3;
    }
  }
}

/** 抵达后收编：赢了留下驻守，输了朝出发城退 */
export function arriveArmy(world: World, a: Army, attackerWins: boolean, keepArmy = false): void {
  const byId = new Map<number, Unit>();
  for (const u of world.units) byId.set(u.id, u);
  const home = world.settlements[a.from];
  for (const id of a.units) {
    const u = byId.get(id);
    if (!u) continue;
    if (keepArmy) {
      u.state = 'walk';
      u.timer = 200;
      continue;
    }
    if (attackerWins) {
      u.state = 'idle';
      u.timer = 60;
      u.army = undefined;
      u.role = 'melee';
    } else {
      // 败退：朝出发城方向撤，队形不再维持
      u.state = 'walk';
      u.timer = 120;
      u.army = undefined;
      u.role = 'melee';
      if (home) {
        u.tx = home.x + 0.5 + (u.x - home.x) * 0.1;
        u.ty = home.y + 0.5 + (u.y - home.y) * 0.1;
      }
    }
  }
}

/**
 * 守军出战：城被围时，城里的兵力在城墙下列成方阵迎敌。
 *
 * 为什么不直接「攻击方撞墙」：用户要看的是一块方阵撞另一块方阵。
 * 守军从城里走出来，两团人在城下相遇，才会出现「两个大方块逐渐逼近」的画面。
 */
export function formGarrison(world: World, cityId: number, foeX: number, foeY: number, foeCount = 26): Army | null {
  const city = world.settlements[cityId];
  if (!city || city.nation < 0) return null;

  const rng = new Rng((world.tick * 6151 + cityId * 37) ^ 0x2cd7);
  // 守军规模贴着攻方的 75% 上下浮动：太弱会被一波推平（看不到拉锯），
  // 太强则攻方永远打不下城（战争失去意义）。
  const total = Math.max(14, Math.min(36, Math.round(foeCount * (0.82 + rng.next() * 0.3))));
  const nArcher = Math.max(3, Math.round(total * 0.34));
  const nMelee = Math.max(4, total - nArcher);

  const dx = foeX - (city.x + 0.5);
  const dy = foeY - (city.y + 0.5);
  const dist = Math.max(0.001, Math.hypot(dx, dy));
  const fx = dx / dist;
  const fy = dy / dist;
  const px = -fy;
  const py = fx;

  // 阵心：城门外一点点，正对敌人
  const cx = city.x + 0.5 + fx * 1.5;
  const cy = city.y + 0.5 + fy * 1.5;

  let nid = nextUnitId(world);
  const armyId = ((world.tick + 7) & 0xffff) * 64 + (cityId & 0x3f) + 32;
  const units: number[] = [];

  const add = (role: UnitRole, side: number, back: number, hp: number): number => {
    const id = nid++;
    world.units.push({
      id, race: city.race, job: 'soldier', nation: city.nation, home: cityId,
      x: cx + px * side + fx * back,
      y: cy + py * side + fy * back,
      tx: cx, ty: cy,
      state: 'fight', timer: 600, anim: rng.int(8), hp,
      dir: Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 2 : 1) : (fy > 0 ? 0 : 3),
      role, army: armyId, fx, fy, ax: side, ay: back,
    });
    units.push(id);
    return id;
  };

  let slot = 0;
  for (let i = 0; i < nMelee; i++, slot++) {
    const row = Math.floor(slot / ARMY_COLS);
    const col = slot % ARMY_COLS;
    add('melee', (col - (ARMY_COLS - 1) / 2) * ARMY_SPACING, -ARMY_SPACING * (row + 1), 100);
  }
  for (let i = 0; i < nArcher; i++) {
    const row = Math.floor(i / ARMY_COLS);
    const col = i % ARMY_COLS;
    add('archer', (col - (ARMY_COLS - 1) / 2) * ARMY_SPACING, ARMY_SPACING * (row + 1), 70);
  }
  const gid = add('general', 0, 0, 180);

  return {
    id: armyId, nation: city.nation, race: city.race,
    kind: 'defend', initial: total + 1,
    from: cityId, to: cityId, general: gid, units,
    x: cx, y: cy, fx, fy,
    state: 'clash', strength: 1, morale: 1,
    arrive: world.tick, timer: 0, resolved: false, retries: 0,
  };
}

/**
 * 补员：撤退回城的军队在城里重新拉人，把编制补齐再压上去。
 *
 * 这是「进攻—受挫—撤退—再集结—反扑」里最容易被忽略的一环：
 * 如果没有补员，败退的军队只会一路缩水，再也组织不起第二次进攻，
 * 战场就变成「一波流」，没有呼吸感。
 */
export function reinforceArmy(world: World, a: Army, n: number): number {
  const home = world.settlements[a.from];
  if (!home || !home.alive || home.ruin) return 0;
  const rng = new Rng((world.tick * 977 + a.id * 13) ^ 0x71b3);
  let nid = nextUnitId(world);
  let added = 0;
  const px = -a.fy;
  const py = a.fx;

  for (let i = 0; i < n; i++) {
    if (a.units.length >= a.initial) break;
    const melee = a.units.length < a.initial * 0.62;
    const row = Math.floor(a.units.length / ARMY_COLS);
    const col = a.units.length % ARMY_COLS;
    const side = (col - (ARMY_COLS - 1) / 2) * ARMY_SPACING;
    const back = (melee ? -1 : 1) * ARMY_SPACING * (row + 1);
    const id = nid++;
    world.units.push({
      id,
      race: a.race,
      job: 'soldier',
      nation: a.nation,
      home: a.from,
      x: a.x + px * side + a.fx * back,
      y: a.y + py * side + a.fy * back,
      tx: a.x,
      ty: a.y,
      state: 'walk',
      timer: 600,
      anim: rng.int(8),
      hp: 100,
      dir: 2,
      role: melee ? 'melee' : 'archer',
      army: a.id,
      fx: a.fx,
      fy: a.fy,
      ax: side,
      ay: back,
    });
    a.units.push(id);
    added++;
  }
  a.strength = Math.max(0, Math.min(1, a.units.length / Math.max(1, a.initial)));
  a.morale = a.strength;
  return added;
}
