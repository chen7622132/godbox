import { Rng } from '../core/rng';
import { makePersonName, raceOf, RACES } from '../core/races';
import { logEvent } from '../core/events';
import {
  T, IS_LAND, YEARS_PER_TICK, TIER_POP, TIER_NAME, TECH_POWER,
  type World, type Settlement, type Nation, type Agent,
} from '../core/types';
import { findLandNear } from '../core/world';

const rng = new Rng(1);

/** 一局的目标长度（tick）。15 分钟 × 10 tick/秒 = 9000 */
export const ROUND_TICKS = 9000;

/** 每 tick 调一次（外部按 SIM_HZ 调用） */
export function stepWorld(world: World): void {
  if (world.ended) return;
  rng.s = world.rngState;
  world.tick++;
  world.year += YEARS_PER_TICK;

  growSettlements(world);
  if (world.tick % 3 === 0) expandTerritories(world);
  if (world.tick % 2 === 0) trySpawnSettlements(world);
  if (world.tick % 5 === 0) updateNations(world);
  if (world.tick % 4 === 0) updateDiplomacy(world);
  if (world.tick % 20 === 0) resolveCampaigns(world);
  if (world.tick % 2200 === 0) triggerEraEvent(world);
  if (world.tick % 30 === 0) updateStats(world);

  world.rngState = rng.s;
}

// ============ 聚落成长 ============

function settlementCap(world: World, s: Settlement): number {
  const i = s.y * world.w + s.x;
  const t = world.terrain[i];
  const f = world.fert[i] / 255;
  const race = raceOf(s.race);
  const n = s.nation >= 0 ? world.nations[s.nation] : undefined;
  const techMul = 1 + (n ? n.tech : 0) * 0.2;
  // 严苛地形容忍：肥力低时种族特性起作用
  const effF = f < 0.5 ? f * race.harshness : f;
  let cap = (40 + effF * 185) * techMul;

  // 种族特性：矮人住在丘陵/山地时挖出地下空间；精灵的森林家园更宽敞
  if (race.mineBonus > 0 && (t === T.Hill || t === T.Mountain)) cap *= 1 + race.mineBonus;
  if (race.forestPower > 1 && t === T.Forest) cap *= 1.2;

  return Math.max(18, cap);
}

function growSettlements(world: World): void {
  const { w, owner } = world;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const race = raceOf(s.race);
    s.cap = settlementCap(world, s);
    const i = s.y * w + s.x;

    // 瘟疫与火灾直接压制
    const plagueHit = world.plague[i] > 0 ? 0.006 : 0;
    const fireHit = world.fire[i] > 0 ? 0.02 : 0;

    const pressure = s.pop / Math.max(1, s.cap);
    let delta = (0.042 + s.pop * 0.0028 * race.growth * (1 - pressure))
      - s.pop * (plagueHit + fireHit);

    // 领土太小（被别国挤死）则饿死
    if (pressure > 1) delta -= s.pop * (pressure - 1) * 0.06;

    s.pop = Math.max(0, s.pop + delta);
    s.food = Math.min(1, s.food + 0.01 * (1 - pressure));

    // 升级
    while (s.tier < 4 && s.pop >= TIER_POP[s.tier + 1]) {
      s.tier++;
      if (s.tier >= 2) {
        logEvent(world, 'grow', `${s.name} 发展为${TIER_NAME[s.tier]}，人口 ${Math.round(s.pop)}`, s.race, 1);
      }
    }
    // 城墙（科技到 3 级后逐步修建）
    const tech = s.nation >= 0 ? world.nations[s.nation].tech : 0;
    const wantWalls = tech >= 3 ? Math.min(4, tech - 2 + race.wallBonus) : 0;
    if (s.walls < wantWalls && s.pop > 60) s.walls++;

    // 人口归零 → 城市废弃
    if (s.pop < 3 && s.tier >= 1) {
      killSettlement(world, s, '被荒废');
      continue;
    }
    if (owner[i] < 0) owner[i] = s.id;
  }
}

export function killSettlement(world: World, s: Settlement, cause: string): void {
  if (!s.alive) return;
  s.alive = false;
  s.ruin = true;
  s.pop = 0;
  const i = s.y * world.w + s.x;
  world.terrain[i] = T.Ruin;
  const n = s.nation >= 0 ? world.nations[s.nation] : undefined;
  if (n) {
    const idx = n.cities.indexOf(s.id);
    if (idx >= 0) n.cities.splice(idx, 1);
  }
  world.stats.citiesDestroyed++;
  logEvent(world, 'ruin', `${s.name} ${cause}，聚落化为废墟`, s.race, 1);
}

// ============ 领土扩张 ============

function expandTerritories(world: World): void {
  const { w, h, owner, terrain } = world;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const r = Math.floor(2 + Math.sqrt(s.pop) * 0.62);
    const inner = Math.max(0, r - 2);
    const r2 = r * r;
    const in2 = inner * inner;
    const y0 = Math.max(1, s.y - r);
    const y1 = Math.min(h - 2, s.y + r);
    const x0 = Math.max(1, s.x - r);
    const x1 = Math.min(w - 2, s.x + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - s.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x - s.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 < in2) continue;
        const i = y * w + x;
        if (owner[i] !== -1) continue;
        if (!IS_LAND[terrain[i]]) continue;
        // 边缘掺入确定性噪声，避免领土长成整齐的圆
        const nz = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
        if (nz < 14) continue;
        owner[i] = s.id;
      }
    }
  }
}

// ============ 建新城（移民） ============

function trySpawnSettlements(world: World): void {
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    if (s.pop < s.cap * 0.42) continue;
    if (s.tier < 1) continue;
    if (world.tick - s.lastSpawn < 120) continue;
    // 城市越密，概率越低
    const minGap = 12;
    let nearest = Infinity;
    for (const o of world.settlements) {
      if (!o.alive || o.id === s.id) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < nearest) nearest = d;
    }
    if (nearest < minGap) continue;
    if (!rng.chance(0.08)) continue;

    const race = raceOf(s.race);
    const ox = s.x + rng.intRange(-26, 26);
    const oy = s.y + rng.intRange(-26, 26);
    // 第一轮：只要本族的偏好地形（这样精灵真的住森林、矮人真的住山区）
    let spot = findLandNear(world, ox, oy, 12, (i) => {
      const t = world.terrain[i];
      if (!IS_LAND[t]) return false;
      if (race.pref.includes(t)) return true;
      return race.buildHarsh && (t === T.Mountain || t === T.Snow);
    });
    // 第二轮：附近实在没有偏好地形，退而求其次
    if (spot < 0) {
      spot = findLandNear(world, ox, oy, 12, (i) => {
        const t = world.terrain[i];
        return IS_LAND[t] && (t === T.Grass || t === T.Hill || t === T.Sand);
      });
    }
    if (spot < 0) continue;
    const picked = world.settlements.filter((o) => o.alive).length;
    // 城数上限随在场种族数放大：2 族约 28 城，4 族约 44 城
    const activeRaces = new Set(world.settlements.filter((o) => o.alive).map((o) => o.race)).size;
    if (picked > 12 + 8 * Math.max(2, activeRaces)) continue;

    const nx = spot % world.w;
    const ny = (spot / world.w) | 0;
    const child = createSettlement(world, nx, ny, s.race, Math.min(16, s.pop * 0.25), false);
    s.pop -= Math.min(16, s.pop * 0.25);
    s.lastSpawn = world.tick;
    child.lastSpawn = world.tick;
    logEvent(world, 'found', `${race.name}在 ${child.name} 建立新${TIER_NAME[0]}`, s.race, 0);
  }
}

export function createSettlement(
  world: World, x: number, y: number, race: number, pop: number, isCapital: boolean,
): Settlement {
  const def = raceOf(race);
  const used = new Set(world.settlements.map((s) => s.name));
  let name = def.cities[0];
  for (const c of def.cities) {
    if (!used.has(c)) { name = c; break; }
  }
  if (used.has(name)) name = name + '之' + ['东', '西', '南', '北', '新', '上'][world.settlements.length % 6];

  const s: Settlement = {
    id: world.settlements.length,
    x, y, race,
    nation: -1,
    pop,
    cap: 200,
    tier: 0,
    founded: world.year,
    walls: 0,
    food: 0.6,
    alive: true,
    name,
    garrison: 0,
    ruin: false,
    capital: isCapital,
    lastSpawn: world.tick,
  };
  world.settlements.push(s);
  world.owner[y * world.w + x] = s.id;
  world.stats.citiesFounded++;
  return s;
}

// ============ 国家 ============

function updateNations(world: World): void {
  // 1) 独立聚落够多 → 建国
  for (let race = 0; race < RACES.length; race++) {
    const free = world.settlements.filter((s) => s.alive && !s.ruin && s.nation < 0 && s.race === race);
    if (free.length < 3) continue;
    free.sort((a, b) => b.pop - a.pop);
    const leader = free[0];
    if (leader.pop < 115) continue;
    if (world.nations.filter((n) => n.alive && n.race === race).length >= 2) continue;

    const members = free.filter((s) => Math.hypot(s.x - leader.x, s.y - leader.y) < 700);
    if (members.length < 2) continue;
    createNation(world, race, members);
  }

  // 2) 国家日常：科技、国王寿命
  for (const n of world.nations) {
    if (!n.alive) continue;
    const race = raceOf(n.race);
    let totalPop = 0;
    n.cities = n.cities.filter((id) => {
      const s = world.settlements[id];
      if (!s || !s.alive) return false;
      totalPop += s.pop;
      return true;
    });
    if (n.cities.length === 0) {
      n.alive = false;
      logEvent(world, 'extinct', `${n.name} 灭亡，最后一城陷落`, n.race, 2);
      continue;
    }
    if (totalPop > n.peakPop) n.peakPop = totalPop;

    // 科技
    if (n.tech < 6) {
      // 矮人特性：城市越多建在丘陵/山地，矿脉带来的研究加成越高
      let mineCities = 0;
      for (const id of n.cities) {
        const s = world.settlements[id];
        if (!s || !s.alive) continue;
        const t = world.terrain[s.y * world.w + s.x];
        if (t === T.Hill || t === T.Mountain) mineCities++;
      }
      const mineMul = race.mineBonus > 0 && n.cities.length > 0
        ? 1 + (mineCities / n.cities.length) * race.mineBonus
        : 1;
      n.techProgress += totalPop * 0.0003 * race.tech * mineMul;
      if (n.techProgress >= 100) {
        n.techProgress = 0;
        n.tech++;
        logEvent(world, 'tech', `${n.name} 掌握了 ${techName(n.tech)}`, n.race, 1);
      }
    }

    // 国王
    const king = world.agents[n.king];
    if (!king || !king.alive) {
      appointKing(world, n);
    } else {
      king.age += YEARS_PER_TICK * 5;
      if (king.age > king.lifespan) {
        king.alive = false;
        logEvent(world, 'death', `${n.name} 的国王 ${king.name} 去世，享年 ${Math.round(king.age)} 岁`, n.race, 1);
        appointKing(world, n);
      }
    }
  }

  // 3) 霸主巩固：城市数过半的国家每 200 tick 吸收一个邻近的独立聚落
  if (world.tick > 0 && world.tick % 200 === 0) {
    const liveCities = world.settlements.filter((s) => s.alive && !s.ruin);
    if (liveCities.length >= 4) {
      for (const n of world.nations) {
        if (!n.alive) continue;
        if (n.cities.length < liveCities.length * 0.6) continue;
        const free = liveCities.filter((s) => s.nation < 0);
        if (!free.length) break;
        const c = nationCenter(world, n);
        let best: Settlement | null = null;
        let bestD = Infinity;
        for (const s of free) {
          const d = Math.hypot(s.x - c.x, s.y - c.y);
          if (d < bestD) { bestD = d; best = s; }
        }
        if (!best || bestD > 140) continue;
        best.nation = n.id;
        best.capital = false;
        n.cities.push(best.id);
        stampNation(world, best.id, n.id);
        logEvent(
          world, 'conquer',
          `${best.name} 向 ${n.name} 称臣，${raceOf(best.race).name}再无力自立`,
          best.race, 2,
        );
        break;
      }
    }
  }
}

function techName(t: number): string {
  return ['无', '部落制', '农耕', '青铜', '铁器', '王国', '帝国'][t] ?? '未知';
}

function createNation(world: World, race: number, members: Settlement[]): Nation {
  const def = raceOf(race);
  const used = new Set(world.nations.map((n) => n.name));
  let name = def.nations[0];
  for (const c of def.nations) {
    if (!used.has(c)) { name = c; break; }
  }
  if (used.has(name)) name = name + ['之二', '之三', '之四'][world.nations.length % 3];

  const capital = members.reduce((a, b) => (a.pop > b.pop ? a : b));
  const id = world.nations.length;
  const n: Nation = {
    id, race, name,
    color: def.color,
    capital: capital.id,
    cities: members.map((m) => m.id),
    tech: 1,
    techProgress: 0,
    king: -1,
    founded: world.year,
    alive: true,
    enemies: [],
    aggression: def.aggression * (0.7 + rng.next() * 0.7),
    warsWon: 0,
    warsLost: 0,
    peakPop: 0,
    lastCampaign: world.tick,
    warSince: 0,
  };
  world.nations.push(n);
  for (const m of members) {
    m.nation = id;
    m.capital = m.id === capital.id;
    const i = m.y * world.w + m.x;
    world.terrain[i] = world.terrain[i];
  }
  // 领土归属：用 nationOf 层
  for (const m of members) {
    stampNation(world, m.id, id);
  }
  appointKing(world, n);
  logEvent(world, 'nation', `${def.name}的 ${name} 建国，定都 ${capital.name}，${members.length} 座聚落归附`, race, 2);
  return n;
}

/** 把某聚落的领土全部标记为某国 */
function stampNation(world: World, sid: number, nid: number): void {
  const { owner, nationOf } = world;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === sid) nationOf[i] = nid;
  }
}

function appointKing(world: World, n: Nation): void {
  const def = raceOf(n.race);
  const a: Agent = {
    id: world.agents.length,
    name: makePersonName(rng, n.race),
    race: n.race,
    nation: n.id,
    role: 'king',
    born: world.year,
    age: rng.intRange(18, 40),
    lifespan: Math.round(def.lifespan * (0.8 + rng.next() * 0.5)),
    talent: 0.75 + rng.next() * 0.85,
    alive: true,
  };
  world.agents.push(a);
  n.king = a.id;
  if (world.agents.filter((x) => x.nation === n.id).length > 1) {
    logEvent(world, 'coronate', `${a.name} 继位为 ${n.name} 之王`, n.race, 1);
  }
}

// ============ 外交 ============

function nationCenter(world: World, n: Nation): { x: number; y: number } {
  let x = 0, y = 0, c = 0;
  for (const id of n.cities) {
    const s = world.settlements[id];
    if (s && s.alive) { x += s.x; y += s.y; c++; }
  }
  return c > 0 ? { x: x / c, y: y / c } : { x: -1, y: -1 };
}

function updateDiplomacy(world: World): void {
  const alive = world.nations.filter((n) => n.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      if (a.enemies.includes(b.id)) continue;
      if (a.cities.length < 3 || b.cities.length < 3) continue;
      // 新生的国家需要时间巩固内部，不会立刻发动战争
      if (world.year - a.founded < 900 || world.year - b.founded < 900) continue;

      const ca = nationCenter(world, a);
      const cb = nationCenter(world, b);
      const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      if (dist > 60) continue;

      const sameRace = a.race === b.race;
      if (sameRace && a.tech < 4) continue;

      const base = sameRace ? 0.0015 : 0.009;
      const p = base * (a.aggression + b.aggression);
      if (rng.chance(p)) declareWar(world, a, b);
    }
  }

  // 霸权威胁：某国城市数过半时，其余国家结成同盟围攻它
  const totalCities = world.settlements.filter((s) => s.alive && !s.ruin).length;
  for (const n of alive) {
    if (n.cities.length < 4 || n.cities.length < totalCities * 0.5) continue;
    // 新生的强权还没形成威胁感，同盟不会立刻成立
    if (world.year - n.founded < 2000) continue;
    const coalition = alive.filter(
      (o) => o.id !== n.id && !o.enemies.includes(n.id) && o.enemies.length < 2,
    );
    if (coalition.length < 1) continue;
    if (!rng.chance(0.012)) continue;
    for (const o of coalition) declareWar(world, o, n);
    logEvent(
      world, 'war',
      `${n.name} 势大，${coalition.map((c) => c.name).join('、')} 结成同盟，共抗强权`,
      n.race, 2,
    );
    break;
  }

  // 议和：战争拖太久
  for (const n of world.nations) {
    if (!n.alive || n.enemies.length === 0) continue;
    if (rng.chance(0.0004) && world.tick - n.warSince > 600) {
      const other = world.nations[n.enemies[0]];
      n.enemies.shift();
      if (other) {
        other.enemies = other.enemies.filter((x) => x !== n.id);
        logEvent(world, 'peace', `${n.name} 与 ${other.name} 停战议和`, n.race, 1);
      }
    }
  }
}

function declareWar(world: World, a: Nation, b: Nation): void {
  a.enemies.push(b.id);
  b.enemies.push(a.id);
  world.stats.warsDeclared++;
  const ka = world.agents[a.king]?.name ?? '王';
  const kb = world.agents[b.king]?.name ?? '王';
  logEvent(
    world, 'war',
    `${a.name}（${ka}）向 ${b.name}（${kb}）宣战！`,
    a.race, 2,
  );
}

// ============ 战役 ============

function nationPower(world: World, n: Nation, attacking: boolean): number {
  const race = raceOf(n.race);
  let pop = 0;
  let forestCities = 0;
  let alive = 0;
  for (const id of n.cities) {
    const s = world.settlements[id];
    if (s && s.alive) {
      pop += s.pop;
      alive++;
      if (world.terrain[s.y * world.w + s.x] === T.Forest) forestCities++;
    }
  }
  const king = world.agents[n.king];
  const talent = king && king.alive ? king.talent : 0.8;
  const base = pop * (attacking ? 0.105 : 0.125);
  let power = base * race.power * TECH_POWER[n.tech] * talent;

  // 精灵：城市越多建在森林里，全体战力越强（在家门口打仗）
  if (race.forestPower > 1 && alive > 0) {
    const ratio = forestCities / alive;
    power *= 1 + (race.forestPower - 1) * ratio;
  }
  return power;
}

function resolveCampaigns(world: World): void {
  for (const a of world.nations) {
    if (!a.alive || a.enemies.length === 0) continue;
    if (world.tick - a.lastCampaign < 60) continue;

    for (const eid of [...a.enemies]) {
      const b = world.nations[eid];
      if (!b || !b.alive || !a.alive) {
        a.enemies = a.enemies.filter((x) => x !== eid);
        continue;
      }
      a.lastCampaign = world.tick;

      // 选目标：b 的城市中离 a 领土最近的
      const ca = nationCenter(world, a);
      let target: Settlement | null = null;
      let best = Infinity;
      for (const id of b.cities) {
        const s = world.settlements[id];
        if (!s || !s.alive) continue;
        const d = Math.hypot(s.x - ca.x, s.y - ca.y);
        if (d < best) { best = d; target = s; }
      }
      if (!target) continue;
      if (best > 150) continue; // 太远，打不到

      const atk = nationPower(world, a, true) * (0.75 + rng.next() * 0.6);
      const defense = nationPower(world, b, false)
        * (1 + target.walls * 0.3)
        * (target.capital ? 1.35 : 1)
        * (0.8 + rng.next() * 0.45);

      world.stats.battles++;
      const ka = world.agents[a.king]?.name ?? '大将';
      const kb = world.agents[b.king]?.name ?? '守将';

      if (atk > defense) {
        conquer(world, a, b, target, ka);
      } else {
        // 攻方受挫
        for (const id of a.cities) {
          const s = world.settlements[id];
          if (s && s.alive) s.pop *= 0.945;
        }
        a.warsLost++;
        logEvent(
          world, 'battle',
          `${target.name} 城下，${b.name} 守军击退 ${a.name} 的进攻（${kb} 对 ${ka}）`,
          b.race, 1,
        );
      }

      // 国王战死
      if (rng.chance(0.006)) {
        const king = world.agents[a.king];
        if (king && king.alive) {
          king.alive = false;
          logEvent(world, 'death', `${a.name} 之王 ${king.name} 战死沙场`, a.race, 2);
          appointKing(world, a);
        }
      }
      break; // 每轮只打一场
    }
  }
}

function conquer(world: World, a: Nation, b: Nation, target: Settlement, attackerName: string): void {
  const lost = Math.round(target.pop * 0.42);
  target.pop *= 0.58;
  target.nation = a.id;
  target.capital = false;
  target.pop = Math.max(8, target.pop);
  // 领土重标
  stampNation(world, target.id, a.id);

  const bi = b.cities.indexOf(target.id);
  if (bi >= 0) b.cities.splice(bi, 1);
  if (!a.cities.includes(target.id)) a.cities.push(target.id);
  a.warsWon++;

  // 攻下一座城需要时间消化：驻军、清剿、安民，这段时间无法再发动攻势
  a.lastCampaign = world.tick + 60;

  // 雪球效应（克制版）：守方士气受损，攻方也因长期战争消耗难以全力扩张
  const loserRace = raceOf(b.race);
  for (const id of b.cities) {
    const s = world.settlements[id];
    if (!s || !s.alive) continue;
    // 兽人特性：丢城反而被激怒，残余人手全体动员
    s.pop *= loserRace.rageGrowth > 0 ? 1 + loserRace.rageGrowth : 0.965;
  }
  for (const id of a.cities) {
    const s = world.settlements[id];
    if (s && s.alive) s.pop *= 1.015;
  }
  a.techProgress += 8;

  logEvent(
    world, 'conquer',
    `${a.name} 攻陷 ${b.name} 的 ${target.name}，屠戮 ${lost} 人（${attackerName} 亲征）`,
    a.race, 2,
  );

  // 首都被占 → 迁都；无城 → 灭国
  if (b.cities.length === 0) {
    b.alive = false;
    logEvent(world, 'extinct', `${b.name} 覆灭，最后一座城落入 ${a.name} 之手`, b.race, 2);
    a.enemies = a.enemies.filter((x) => x !== b.id);
  } else if (b.capital === target.id) {
    let newCap = b.cities[0];
    let bestPop = -1;
    for (const id of b.cities) {
      const s = world.settlements[id];
      if (s && s.alive && s.pop > bestPop) { bestPop = s.pop; newCap = id; }
    }
    b.capital = newCap;
    const s = world.settlements[newCap];
    if (s) {
      s.capital = true;
      logEvent(world, 'coronate', `${b.name} 迁都 ${s.name}`, b.race, 1);
    }
  }
}

// ============ 时代事件（推动格局变化，避免世界陷入静态拉锯） ============

function triggerEraEvent(world: World): void {
  const live = world.settlements.filter((s) => s.alive && !s.ruin);
  const kinds = ['plague', 'fire', 'enlighten', 'migrate'] as const;
  const kind = rng.pick(kinds);
  const { w, h, terrain } = world;

  switch (kind) {
    case 'plague': {
      if (!live.length) return;
      const s = rng.pick(live);
      for (let dy = -7; dy <= 7; dy++) {
        const y = s.y + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -7; dx <= 7; dx++) {
          const x = s.x + dx;
          if (x < 0 || x >= w) continue;
          if (dx * dx + dy * dy > 49) continue;
          const i = y * w + x;
          if (IS_LAND[terrain[i]]) world.plague[i] = 200;
        }
      }
      world.hasPlague = true;
      world.stats.disasters++;
      logEvent(world, 'plague', `黑死病自 ${s.name} 爆发，席卷整个${raceOf(s.race).name}世界`, -1, 2);
      break;
    }

    case 'fire': {
      if (!live.length) return;
      const s = rng.pick(live);
      let lit = 0;
      for (let dy = -6; dy <= 6; dy++) {
        const y = s.y + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -6; dx <= 6; dx++) {
          const x = s.x + dx;
          if (x < 0 || x >= w) continue;
          if (dx * dx + dy * dy > 36) continue;
          const i = y * w + x;
          const t = terrain[i];
          if (t === T.Forest || t === T.Grass) {
            world.fire[i] = 150;
            lit++;
          }
        }
      }
      if (lit > 0) world.hasFire = true;
      world.stats.disasters++;
      logEvent(world, 'disaster', `大旱三年，${s.name} 周边燃起山火`, -1, 2);
      break;
    }

    case 'enlighten': {
      const nations = world.nations.filter((n) => n.alive);
      if (!nations.length) return;
      const n = rng.pick(nations);
      if (n.tech >= 6) return;
      n.tech++;
      logEvent(world, 'tech', `一场知识革命席卷 ${n.name}，技艺跃升至 ${techName(n.tech)}`, n.race, 2);
      break;
    }

    case 'migrate': {
      const races = [0, 1, 2, 3].filter((r) => live.some((s) => s.race === r));
      if (!races.length) return;
      const race = rng.pick(races);
      const def = raceOf(race);
      let made = 0;
      for (let t = 0; t < 60 && made < 2; t++) {
        const spot = findLandNear(
          world, rng.int(w), rng.int(h), 10,
          (i) => IS_LAND[terrain[i]] && def.pref.includes(terrain[i]),
        );
        if (spot < 0) continue;
        const sx = spot % w;
        const sy = (spot / w) | 0;
        let tooClose = false;
        for (const s of world.settlements) {
          if (s.alive && Math.hypot(s.x - sx, s.y - sy) < 12) { tooClose = true; break; }
        }
        if (tooClose) continue;
        createSettlement(world, sx, sy, race, 18, false);
        made++;
      }
      if (made > 0) {
        logEvent(world, 'found', `大迁徙时代：${def.name}向未知之地开拓了 ${made} 处新家园`, race, 2);
      }
      break;
    }
  }
}

// ============ 统计与终局 ============

function updateStats(world: World): void {
  let total = 0;
  const racePop = [0, 0, 0, 0];
  const raceHas = [false, false, false, false];
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    total += s.pop;
    racePop[s.race] += s.pop;
    raceHas[s.race] = true;
  }
  if (total > world.stats.peakPop) world.stats.peakPop = total;
  for (let r = 0; r < 4; r++) {
    if (racePop[r] > world.stats.racePeak[r]) world.stats.racePeak[r] = racePop[r];
    if (!raceHas[r] && world.stats.racePeak[r] > 0 && !world.extincted[r]) {
      world.extincted[r] = true;
      logEvent(world, 'extinct', `${RACES[r].name} 彻底从世界上消失了`, r, 2);
    }
  }
  world.stats.popHistory.push([world.tick, Math.round(total)]);
  if (world.stats.popHistory.length > 400) world.stats.popHistory.shift();

  // 终局：只有一个国家，且它控制了绝大部分城市（剩下的零星部落算臣服）
  const aliveNations = world.nations.filter((n) => n.alive);
  const cities = world.settlements.filter((s) => s.alive && !s.ruin);
  if (cities.length >= 3 && aliveNations.length === 1) {
    const only = aliveNations[0];
    const owned = cities.filter((s) => s.nation === only.id).length;
    if (owned / cities.length >= 0.75) {
      world.ended = true;
      world.endReason = `${only.name} 统一了世界`;
      logEvent(world, 'unify', `${only.name} 统一了已知世界，${only.name}的时代开始了`, only.race, 2);
    }
  }
  if (cities.length === 0 && world.year > 50) {
    world.ended = true;
    world.endReason = '世界陷入死寂，再无文明';
  }
  // 15 分钟到点（9000 tick）：无论格局如何，时代落幕
  if (!world.ended && !world.overtime && world.tick >= ROUND_TICKS) {
    world.ended = true;
    world.endReason = '时代落幕 —— 史书写到了最后一页';
    logEvent(world, 'unify', '纪元终结。世界将带着这一局的遗产进入下一轮循环', -1, 2);
  }
}
