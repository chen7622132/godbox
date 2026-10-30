import { Rng } from '../core/rng';
import { makePersonName, raceOf, RACES } from '../core/races';
import { logEvent } from '../core/events';
import {
  T, IS_LAND, YEARS_PER_TICK, TIER_POP, TIER_NAME, TECH_POWER, FOOD,
  type World, type Settlement, type Nation, type Agent, type MoodState, type StatusKind,
  type Ambition,
} from '../core/types';
import { Narrator, grandNum } from '../core/narrative';
import { updateBeasts, maybeAwakenBeast } from './beasts';
import { updateWonders, wonderBuff } from './wonders';
import { updateUnits, syncUnitsToCities, spawnBattle, endBattles } from './units';
import { findLandNear } from '../core/world';

const rng = new Rng(1);
const narrator = new Narrator(rng);

/** 五种执念，君主从中抽一个 */
const AMBITIONS: Ambition[] = ['conquer', 'revenge', 'glory', 'peace', 'wealth'];

/** 一局的目标长度（tick）。15 分钟 × 10 tick/秒 = 9000 */
export const ROUND_TICKS = 9000;

/** 各族最爱的食物：人类爱谷物、精灵爱野果、矮人爱谷物、兽人爱兽肉 */
const FAV_FOOD: number[] = [FOOD.Grain, FOOD.Berry, FOOD.Grain, FOOD.Meat];

/**
 * 按周边地形推导本城实际能吃到的「唯一主食」。
 * 只产一种粮 —— 这正是 WorldBox「周期性情绪低落 → 外交崩盘 → 叛乱」的根源。
 */
function deriveFoodKind(world: World, x: number, y: number): number {
  let water = 0;
  let forest = 0;
  let hill = 0;
  let grass = 0;
  const R = 7;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const t = world.terrain[ny * world.w + nx];
      if (t === T.Water || t === T.Deep) water++;
      else if (t === T.Forest) forest++;
      else if (t === T.Hill || t === T.Mountain) hill++;
      else if (t === T.Grass) grass++;
    }
  }
  const best = Math.max(water, forest, hill, grass);
  if (best === water) return FOOD.Fish;
  if (best === forest) return FOOD.Berry;
  if (best === hill) return FOOD.Meat;
  return FOOD.Grain;
}

/** 进食间隔（tick）：一天吃几顿 */
const MEAL_EVERY = 260;

/** 情绪 → 幸福度基准值 */
const MOOD_VALUE: Record<MoodState, number> = {
  happy: 62,
  normal: 5,
  sad: -52,
  angry: -86,
};

/**
 * WorldBox 情绪状态机：只由「吃到什么」推导。
 *   吃到最爱的食物      → happy
 *   happy 再吃任何东西  → normal
 *   normal 吃到不爱吃的 → 20% 变 sad
 *   sad 吃到不爱吃的    → 5%  变 angry
 */
function eatOnce(s: Settlement): void {
  const fav = s.foodKind === s.favFood;
  let next: MoodState = s.mood;

  if (fav) {
    next = 'happy';
  } else if (s.mood === 'happy') {
    next = 'normal';
  } else if (s.mood === 'normal') {
    if (rng.next() < 0.2) next = 'sad';
  } else if (s.mood === 'sad') {
    if (rng.next() < 0.05) next = 'angry';
  }

  if (next !== s.mood) {
    s.mood = next;
    // 情绪切换时立刻挂一个可见状态（铁律：1 秒内必须有像素变化）
    if (next === 'happy') setStatus(s, 'sing', 160);
    else if (next === 'sad') setStatus(s, 'cry', 200);
    else if (next === 'angry') setStatus(s, 'tantrum', 220);
  }

  // 幸福度向档位基准缓动
  const target = MOOD_VALUE[s.mood];
  s.happiness += (target - s.happiness) * 0.5;
  if (s.happiness > 100) s.happiness = 100;
  if (s.happiness < -100) s.happiness = -100;
}

/** 给城池挂一个可见状态 */
function setStatus(s: Settlement, kind: StatusKind, dur: number): void {
  s.status = kind;
  s.statusUntil = world_tick_ref + dur;
}

/** 当前 tick 引用（供 setStatus 使用，避免层层传参） */
let world_tick_ref = 0;

/** 情绪对人口增长的乘数：快乐的人更愿意生，悲伤的人缩在家里 */
function moodGrowthMul(m: MoodState): number {
  if (m === 'happy') return 1.25;
  if (m === 'sad') return 0.72;
  if (m === 'angry') return 0.88;
  return 1;
}

/**
 * 情绪主循环。这条规则在眼前真实运转，「活人感」才会出现 ——
 * 只有一个粮食来源的村子，会走完：情绪低落 → 人口流失 → 反复砸房。
 */
function updateMoods(world: World): void {
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;

    // 旧存档兼容
    if (s.mood === undefined) {
      s.mood = 'normal';
      s.happiness = 0;
      s.foodKind = deriveFoodKind(world, s.x, s.y);
      s.favFood = FAV_FOOD[s.race] ?? FOOD.Grain;
      s.lastMeal = world.tick;
      s.status = null;
      s.statusUntil = 0;
      s.miseryTicks = 0;
      s.damage = 0;
    }

    // 1) 进餐：情绪只由「吃到什么」决定
    if (world.tick - s.lastMeal >= MEAL_EVERY) {
      s.lastMeal = world.tick;
      eatOnce(s);
      if (s.mood === 'sad' || s.mood === 'angry') {
        s.miseryTicks += MEAL_EVERY;
      } else {
        s.miseryTicks = Math.max(0, s.miseryTicks - MEAL_EVERY * 0.5);
      }
    }

    // 2) 状态到期自动消失
    if (s.status && world.tick >= s.statusUntil) s.status = null;

    // 3) 愤怒 → 发脾气砸房子（房子真的会变破损，俯瞰图上最明显）
    if (s.mood === 'angry' && rng.next() < 0.006) {
      s.damage = Math.min(1, s.damage + 0.24);
      setStatus(s, 'tantrum', 120);
      if (s.damage > 0.62 && rng.next() < 0.28) {
        logEvent(
          world, 'revolt', `${s.name} 的民众暴怒，砸毁了自家房屋`, s.race, 0,
          { cause: `粮荒日久，民怨沸腾（主食：${s.foodKind === s.favFood ? '合口' : '不合口'}）` },
        );
        s.pop = Math.max(1, s.pop * 0.965);
      }
    }

    // 3.5) 引进新粮 —— 单一种粮的苦日子，是有出路的
    //      （这是全篇最重要的转折点：一座城从常年暴怒变成有歌声）
    if (s.foodKind !== s.favFood && s.tier >= 2 && rng.next() < 0.012) {
      s.foodKind = s.favFood;
      s.mood = 'happy';
      s.happiness = 40;
      s.miseryTicks = 0;
      setStatus(s, 'sing', 240);
      logEvent(
        world, 'legend',
        `${s.name} 引进了新的作物与渔法，仓廪渐丰。街巷上第一次响起歌声。`,
        s.race, 2,
        {
          actor: s.nation >= 0 ? world.agents[world.nations[s.nation].king]?.name : undefined,
          cause: `${s.name} 世代只吃一种粮食，直到这一年`,
        },
      );
    }

    // 4) 房屋缓慢修缮
    if (s.damage > 0) s.damage = Math.max(0, s.damage - 0.0045);

    // 5) 长期悲苦 → 人口外流（不满的人离开，比直接叛乱更稳）
    if (s.miseryTicks > 2000 && rng.next() < 0.012) {
      const lost = Math.max(1, s.pop * 0.06);
      s.pop = Math.max(1, s.pop - lost);
      s.miseryTicks = 1400;
      logEvent(
        world, 'revolt', `${s.name} 的居民因长期饥苦而大批出走`, s.race, 1,
        { cause: `${s.name} 世代只吃一种粮食，人心早已离散` },
      );
    }
  }
}

/** 每 tick 调一次（外部按 SIM_HZ 调用） */
export function stepWorld(world: World): void {
  if (world.ended) return;
  rng.s = world.rngState;
  world.tick++;
  world.year += YEARS_PER_TICK;
  world_tick_ref = world.tick;

  growSettlements(world);
  updateMoods(world);
  if (world.tick % 30 === 0) updateBeasts(world);
  if (world.tick % 40 === 0) updateWonders(world);
  updateUnits(world);
  syncUnitsToCities(world);
  endBattles(world);
  if (world.tick % 3 === 0) expandTerritories(world);
  if (world.tick % 2 === 0) trySpawnSettlements(world);
  if (world.tick % 5 === 0) updateNations(world);
  if (world.tick % 4 === 0) updateDiplomacy(world);
  if (world.tick % 20 === 0) resolveCampaigns(world);
  if (world.tick % 2200 === 0) {
    // 卷末：先写史评，再开新卷
    const eraNo = Math.floor(world.tick / 2200);
    const count = world.events.filter((e) => e.level >= 1 && (e.era ?? 0) === eraNo - 1).length;
    logEvent(world, 'legend', narrator.eraComment(count), -1, 2, { era: eraNo - 1 });
    triggerEraEvent(world);

  }
  if (world.tick % 30 === 0) updateStats(world);

  world.rngState = rng.s;

  // 必须放在 rngState 写回之后：它自己要推进随机状态，
  // 放在前面会被这一行覆盖掉，导致每次掷出同一个结果。
  if (world.tick % 1100 === 0) maybeAwakenBeast(world);
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

  return Math.max(18, cap * (n ? wonderBuff(world, n).cap : 1));
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

    // 情绪直接改变生育意愿：快乐的村子长得快，悲伤的村子缩在家里
    if (delta > 0) delta *= moodGrowthMul(s.mood ?? 'normal');

    // 帝国过载：版图越大，治理成本超线性上升（历史动力学：行政半径决定兴衰）
    // 这是阻止「强者恒强」的第一道闸门
    const nat = s.nation >= 0 ? world.nations[s.nation] : undefined;
    if (nat && delta > 0) {
      const over = Math.max(0, nat.cities.length - 5);
      if (over > 0) delta *= Math.max(0.28, 1 - over * 0.095);
    }

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
    // tier 2 起就该有土墙，科技越高墙越厚 —— 否则「城」看起来没有边界
    const wantWalls = s.tier >= 2 || tech >= 3
      ? Math.min(4, 1 + Math.max(0, tech - 3) + race.wallBonus)
      : 0;
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
        // 边缘掺入两层确定性噪声，避免领土长成整齐的圆
        const nz = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
        const nz2 = (((x * 83492791) ^ (y * 29883667)) >>> 0) % 100;
        if (nz < 18 || nz2 < 12) continue;
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

    mood: 'normal',
    happiness: 0,
    foodKind: deriveFoodKind(world, x, y),
    favFood: FAV_FOOD[race] ?? FOOD.Grain,
    lastMeal: world.tick,
    status: null,
    statusUntil: 0,
    miseryTicks: 0,
    damage: 0,
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
      n.techProgress += totalPop * 0.0003 * race.tech * mineMul * wonderBuff(world, n).tech;
      if (n.techProgress >= 100) {
        n.techProgress = 0;
        n.tech++;
        logEvent(
          world, 'tech',
          `${n.name} 步入 ${techName(n.tech)} 时代，工坊里第一次传出新的声音`,
          n.race, 1,
          { actor: world.agents[n.king]?.name, cause: `${n.name} 的人口与矿脉足以供养匠人` },
        );
      }
    }

    // 国王
    const king = world.agents[n.king];
    if (!king || !king.alive) {
      appointKing(world, n);
    } else {
      king.age += YEARS_PER_TICK * 5;
      king.reign += YEARS_PER_TICK * 5;
      if (king.age > king.lifespan) {
        // 老死：给他一个说法，而不是一个数字
        const deathCause = rng.pick([
          '积劳成疾，崩于王座',
          '寿终正寝',
          '夜半无疾而终',
          '久病不愈，崩',
        ]);
        killKing(world, n, king, deathCause, -1);
      }
    }

    // 帝国裂解：疆域过大且已经打过仗的国家，边地会先离心
    if (!n.fractured && n.cities.length >= 7 && n.warCount >= 1 && rng.chance(0.011)) {
      splitNation(world, n);
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

    grudge: [],
    doctrine: rng.pick(AMBITIONS),
    dynasty: '',
    warCount: 0,
    fractured: false,
    allies: [],
    allyKingA: -1,
    allyKingB: -1,
    allyUntil: 0,
    betrayals: 0,
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
  const traits = narrator.rollTraits();
  // 有血债的国家更容易出复仇型君主 —— 仇恨会塑造下一代的性格
  const grudged = (n.grudge ?? []).some((g) => g > 800);
  const ambition: Ambition = grudged && rng.chance(0.55)
    ? 'revenge'
    : rng.pick(AMBITIONS);

  const fatherId = n.king >= 0 && world.agents[n.king] ? n.king : null;
  const startAge = rng.intRange(18, 40);
  const a: Agent = {
    id: world.agents.length,
    name: makePersonName(rng, n.race),
    race: n.race,
    nation: n.id,
    role: 'king',
    born: Math.round(world.year - startAge),
    age: startAge,
    lifespan: Math.round(def.lifespan * (0.8 + rng.next() * 0.5)),
    talent: 0.75 + rng.next() * 0.85,
    alive: true,

    epithet: '',
    traits,
    ambition,
    father: fatherId,
    killedBy: -1,
    nemesis: -1,
    warsWon: 0,
    warsLost: 0,
    citiesTaken: 0,
    citiesLost: 0,
    popSlain: 0,
    citiesFounded: 0,
    reign: 0,
    deeds: [],
    cause: null,
    posthumous: '',
    diedYear: null,
  };
  world.agents.push(a);
  n.king = a.id;
  if (!n.dynasty) n.dynasty = a.name;
  a.deeds.push({
    year: Math.round(world.year),
    text: fatherId !== null ? `继父之位，为 ${n.name} 之主` : `立为 ${n.name} 之主，开 ${a.name} 之朝`,
    weight: 1,
  });

  if (fatherId !== null) {
    const father = world.agents[fatherId];
    const fatherName = father?.name ?? null;
    if (fatherName) {
      logEvent(
        world, 'coronate',
        narrator.coronationText(a.name, n.name, fatherName),
        n.race, 1,
        { actor: a.name, quote: narrator.heirQuote(), cause: `先王 ${fatherName} 崩` },
      );
      // 子承父仇：父亲是被谁杀的，这儿子一上台就记着
      if (father && father.ambition === 'revenge' && father.killedBy >= 0) {
        n.grudge[father.killedBy] = (n.grudge[father.killedBy] ?? 0) + 400;
      }
    }
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

/** 好战的性格标签 / 克制的性格标签 */
const HAWK_TRAITS = ['嗜血', '好战', '残暴', '狂傲', '刚愎'];
const DOVE_TRAITS = ['仁厚', '谨慎', '重诺'];

/**
 * 君主性格对宣战概率的放大/抑制。
 * 这一条让「同样两个国家，换个国王，历史就完全不同」——
 * 性格不是装饰，是因果。
 */
function warlike(world: World, n: Nation): number {
  const k = world.agents[n.king];
  if (!k || !k.alive) return 1;
  let f = 1;
  if (k.traits.some((t) => HAWK_TRAITS.includes(t))) f *= 1.7;
  if (k.traits.some((t) => DOVE_TRAITS.includes(t))) f *= 0.5;
  if (k.ambition === 'conquer' || k.ambition === 'revenge') f *= 1.5;
  if (k.ambition === 'peace') f *= 0.55;
  return f * wonderBuff(world, n).aggression;
}

/**
 * 联姻与背叛。《十字军之王》的核心洞察：盟约不是纸，是「两家人」。
 * 所以它的有效期绑在具体的人身上 —— 谁死了，盟约就淡了；
 * 而一旦强弱逆转，强者就会想起「这块地本来该是我的」。
 */
function handleAlliances(world: World): void {
  const alive = world.nations.filter((n) => n.alive);

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];

      // ---- 已有盟约：检查是否随人而亡 ----
      if (a.allies.includes(b.id)) {
        // 君主更替不再立即解约：还有期限，且先王死后仍有一半概率维持
        const kingChanged = a.allyKingA !== a.king || a.allyKingB !== b.king;
        const still = world.year < a.allyUntil && !(kingChanged && rng.chance(0.5));
        if (!still) {
          a.allies = a.allies.filter((x) => x !== b.id);
          b.allies = b.allies.filter((x) => x !== a.id);
          logEvent(
            world, 'peace',
            `${a.name} 与 ${b.name} 的盟约随先王一同入土。两国各归其道。`,
            a.race, 1,
            { cause: '盟约系于人身，人亡则约解' },
          );
          continue;
        }

        // ---- 背叛：强者忍不住 ----
        const ka = world.agents[a.king];
        const kb = world.agents[b.king];
        if (!ka || !kb) continue;
        const greedy = ka.traits.includes('贪婪') || ka.traits.includes('残暴') || ka.ambition === 'conquer';
        const stronger = a.cities.length >= Math.max(3, b.cities.length * 1.4);
        if (greedy && stronger && rng.chance(0.008)) {
          a.allies = a.allies.filter((x) => x !== b.id);
          b.allies = b.allies.filter((x) => x !== a.id);
          a.betrayals++;
          declareWar(world, a, b);
          logEvent(
            world, 'betray',
            `${a.name} 撕毁与 ${b.name} 的盟约。使者还在路上，前锋已抵城下。`,
            a.race, 2,
            {
              actor: ka.name,
              cause: `${a.name} 已强于 ${b.name} 一倍，盟约不再划算`,
              quote: '「盟约是给势均力敌的人签的。」',
            },
          );
        }
        continue;
      }

      // ---- 新盟约 ----
      if (a.enemies.includes(b.id)) continue;
      if (a.cities.length < 2 || b.cities.length < 2) continue;
      // 势均力敌的不结盟 —— 弱势方才需要靠山
      const ratio = Math.min(a.cities.length, b.cities.length) / Math.max(a.cities.length, b.cities.length);
      if (ratio > 0.9) continue;
      // 血债太深，谈不拢
      if ((a.grudge[b.id] ?? 0) > 400 || (b.grudge[a.id] ?? 0) > 400) continue;
      const ca = nationCenter(world, a);
      const cb = nationCenter(world, b);
      if (Math.hypot(ca.x - cb.x, ca.y - cb.y) > 85) continue;
      if (!rng.chance(0.006)) continue;

      a.allies.push(b.id);
      b.allies.push(a.id);
      a.allyKingA = a.king;
      a.allyKingB = b.king;
      b.allyKingA = b.king;
      b.allyKingB = a.king;
      const until = world.year + 60 + rng.next() * 90;
      a.allyUntil = until;
      b.allyUntil = until;

      const ka = world.agents[a.king];
      const weakIsA = a.cities.length < b.cities.length;
      logEvent(
        world, 'peace',
        `${weakIsA ? a.name : b.name} 遣使求婚，${weakIsA ? b.name : a.name} 许之。两国结为姻亲，共进退。`,
        weakIsA ? a.race : b.race, 2,
        {
          actor: ka?.name,
          cause: `${weakIsA ? a.name : b.name} 势弱，须得一强援`,
          quote: '「我嫁出去的不是女儿，是十年的太平。」',
        },
      );
    }
  }
}

function updateDiplomacy(world: World): void {
  const alive = world.nations.filter((n) => n.alive);
  handleAlliances(world);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      if (a.enemies.includes(b.id)) continue;
      if (a.allies.includes(b.id)) continue; // 盟友之间不打
      if (a.cities.length < 3 || b.cities.length < 3) continue;
      // 新生的国家需要时间巩固内部，不会立刻发动战争
      if (world.year - a.founded < 45 || world.year - b.founded < 45) continue;

      const ca = nationCenter(world, a);
      const cb = nationCenter(world, b);
      const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      if (dist > 60) continue;

      const sameRace = a.race === b.race;
      if (sameRace && a.tech < 4) continue;

      const base = sameRace ? 0.0012 : 0.0072;
      // 性格真的会改变历史：好战之君把国家拖进战争，仁厚之君守住太平
      const p = base * (a.aggression + b.aggression) * warlike(world, a) * warlike(world, b);
      if (rng.chance(p)) declareWar(world, a, b);
    }
  }

  // 霸权威胁：某国城市数过半时，其余国家结成同盟围攻它
  const totalCities = world.settlements.filter((s) => s.alive && !s.ruin).length;
  for (const n of alive) {
    if (n.cities.length < 4 || n.cities.length < totalCities * 0.5) continue;
    // 新生的强权还没形成威胁感，同盟不会立刻成立
    if (world.year - n.founded < 100) continue;
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
  a.allies = a.allies.filter((x) => x !== b.id);
  b.allies = b.allies.filter((x) => x !== a.id);
  a.enemies.push(b.id);
  b.enemies.push(a.id);
  a.warCount++;
  b.warCount++;
  world.stats.warsDeclared++;
  a.warSince = world.tick;

  const ka = world.agents[a.king];
  const kb = world.agents[b.king];
  const nameA = ka?.name ?? '王';
  const nameB = kb?.name ?? '王';
  const grudge = (a.grudge[b.id] ?? 0) + (b.grudge[a.id] ?? 0);

  if (grudge > 600 && ka) {
    // 复仇战争：不是随机宣战，是二十年前那笔血债到期了
    logEvent(
      world, 'war',
      narrator.revengeText(nameA, a.name, b.name, grudge),
      a.race, 2,
      {
        actor: nameA,
        quote: '「血债不偿，我死不瞑目。」',
        cause: `${b.name} 欠下 ${grandNum(grudge)} 条人命`,
      },
    );
    ka.ambition = 'revenge';
    a.grudge[b.id] = 0; // 一次清算
    ka.deeds.push({ year: Math.round(world.year), text: `为 ${b.name} 所杀之 ${grandNum(grudge)} 复仇，举兵伐之`, weight: 2 });
  } else {
    const reason = narrator.warReason(ka?.traits ?? ['好战']);
    logEvent(
      world, 'war',
      narrator.warText(a.name, nameA, b.name, nameB, reason),
      a.race, 2,
      { actor: nameA, quote: narrator.warQuote(ka?.traits), cause: reason },
    );
    if (ka) ka.deeds.push({ year: Math.round(world.year), text: `伐 ${b.name}`, weight: 1 });
  }
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
  // 奇观加成（矮人的深炉 +20%）
  power *= wonderBuff(world, n).power;
  // 盟友援助：每个生存的盟友 +12%
  for (const aid of n.allies) {
    const ally = world.nations[aid];
    if (ally && ally.alive) power *= 1.12;
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
        spawnBattle(world, target.id, a.race, a.id, true);
        conquer(world, a, b, target, ka);
        const ak = world.agents[a.king];
        if (ak) ak.warsWon++;
      } else {
        // 攻方受挫
        for (const id of a.cities) {
          const s = world.settlements[id];
          if (s && s.alive) s.pop *= 0.945;
        }
        a.warsLost++;
        spawnBattle(world, target.id, a.race, a.id, false);
        const ak = world.agents[a.king];
        if (ak) {
          ak.warsLost++;
          ak.deeds.push({
            year: Math.round(world.year),
            text: `攻 ${target.name} 不克，${narrator.defeatReaction()}`,
            weight: 1,
          });
        }
        logEvent(
          world, 'battle',
          narrator.defenseText(kb, b.name, ka, a.name, target.name),
          b.race, 0,
          { actor: kb, quote: narrator.defeatQuote(), cause: `${b.name} 城坚，攻之不克` },
        );
      }

      // 国王战死
      if (rng.chance(0.006)) {
        const king = world.agents[a.king];
        if (king && king.alive) {
          killKing(world, a, king, `战死于 ${target.name} 城下`, b.id);
        }
      }
      break; // 每轮只打一场
    }
  }
}

/**
 * 帝国裂解。历史动力学的基本结论：疆域一旦超过行政能力，
 * 中央必然失去对边远城市的控制 —— 这不是随机事件，是结构性必然。
 * 它给「强者恒强」上了第二道闸门，也是全篇最有分量的叙事之一。
 */
function splitNation(world: World, n: Nation): void {
  const cities = n.cities
    .map((id) => world.settlements[id])
    .filter((s): s is Settlement => !!s && s.alive && !s.ruin);
  if (cities.length < 7) return;

  const c0 = nationCenter(world, n);
  // 离都城最远的那一半先离心
  cities.sort(
    (a, b) => Math.hypot(b.x - c0.x, b.y - c0.y) - Math.hypot(a.x - c0.x, a.y - c0.y),
  );
  const half = cities.slice(0, Math.floor(cities.length / 2));
  if (half.length < 3) return;

  n.fractured = true;
  for (const s of half) {
    const i = n.cities.indexOf(s.id);
    if (i >= 0) n.cities.splice(i, 1);
  }

  const nn = createNation(world, n.race, half);
  nn.fractured = true;
  nn.grudge = [...n.grudge];
  nn.doctrine = 'conquer';

  const king = nn.king >= 0 ? world.agents[nn.king] : undefined;
  logEvent(
    world, 'revolt',
    `${n.name} 裂为二。边地诸城不再奉诏，拥立 ${king?.name ?? '新主'} 自立，国号 ${nn.name}。`,
    n.race, 2,
    {
      actor: king?.name,
      cause: `${n.name} 疆域已超出号令所及，边城距都城太远`,
      quote: '「京城的命令到这里，已经晚了三个月。」',
    },
  );
  if (king) {
    king.deeds.push({
      year: Math.round(world.year),
      text: `自 ${n.name} 分裂而出，立 ${nn.name}`,
      weight: 2,
    });
  }
}

/**
 * 一位君主的死。这是编年史最有分量的一个事件：
 * 要把死因、遗言、以及「这笔账记在谁头上」一次写清。
 */
function killKing(world: World, n: Nation, k: Agent, cause: string, killerNation: number): void {
  k.alive = false;
  k.diedYear = Math.round(world.year);
  k.cause = cause;
  k.killedBy = killerNation;
  if (!k.epithet) k.epithet = narrator.epithet(k.traits, k);
  k.deeds.push({ year: Math.round(world.year), text: cause, weight: 2 });

  // 太平年也要写一笔 —— 否则列传里只剩打仗的人
  if (k.warsWon + k.warsLost === 0 && k.reign > 20) {
    k.deeds.push({
      year: Math.round(world.year),
      text: `在位 ${Math.round(k.reign)} 载，未动刀兵，境内称安`,
      weight: 1,
    });
  }
  if (k.citiesTaken > 0 && !k.epithet) {
    k.deeds.push({
      year: Math.round(world.year),
      text: `一生拔城 ${k.citiesTaken} 座`,
      weight: 1,
    });
  }

  const post = narrator.posthumous(k);
  k.posthumous = post;
  logEvent(
    world, 'death',
    narrator.deathText(k.name, Math.round(k.age), cause, k.epithet, post),
    n.race,
    // 只有真正干过事的人，死了才值得进「重要事件」
    k.warsWon + k.citiesTaken + k.popSlain / 500 >= 1 ? 2 : 1,
    { actor: k.name, quote: narrator.deathQuote(k.traits), cause },
  );

  // 血债入账：下一位君主会记得这笔账
  if (killerNation >= 0) {
    n.grudge[killerNation] = (n.grudge[killerNation] ?? 0) + 1200;
    const kn = world.nations[killerNation];
    if (kn) {
      logEvent(
        world, 'feud',
        narrator.feudText(n.name, kn.name, 1200),
        n.race, 1,
        { actor: k.name, cause: `${k.name} 死于 ${kn.name} 之手` },
      );
    }
  }
  appointKing(world, n);
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

  // 血债入账：被杀的人不会白死，这笔账会变成二十年后的战争
  b.grudge[a.id] = (b.grudge[a.id] ?? 0) + lost;
  const ak = world.agents[a.king];
  if (ak) {
    ak.citiesTaken++;
    ak.popSlain += lost;
    ak.deeds.push({
      year: Math.round(world.year),
      text: `拔 ${target.name}，屠 ${grandNum(lost)}`,
      weight: target.pop > 120 ? 2 : 1,
    });
  }

  logEvent(
    world, 'conquer',
    narrator.conquerText(attackerName, a.name, target.name, lost),
    a.race, 2,
    {
      actor: attackerName,
      quote: narrator.victoryQuote(ak?.traits),
      cause: `${target.name} 守军不敌`,
    },
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
      const king = only.king >= 0 ? world.agents[only.king] : undefined;
      const who = king ? `${king.name}${king.epithet ? `（${king.epithet}）` : ''}` : only.name;
      world.endReason = `${only.name} 统一了世界`;
      logEvent(
        world, 'unify',
        `天下归一。${who} 立于 ${only.name} 都城之上，四野再无旗号相抗。史官至此搁笔，因已无国可记。`,
        only.race, 2,
        {
          actor: king?.name,
          cause: `${only.name} 历 ${only.warCount} 战，终并天下`,
          quote: king ? '「我以为这一天来了会很痛快。」' : undefined,
        },
      );
    }
  }
  if (cities.length === 0 && world.year > 12) {
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
