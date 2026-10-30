import { Rng } from '../core/rng';
import { logEvent } from '../core/events';
import { raceOf } from '../core/races';
import { IS_LAND, T, type World, type Beast, type Settlement, type Nation } from '../core/types';

/** 巨兽名字：兽形 + 特征，拼出来就是一只具体的怪物 */
const BEAST_HEAD = ['焰', '石', '铁', '影', '血', '霜', '雷', '骨', '腐', '九', '无', '赤'];
const BEAST_TAIL = ['喉', '鳞', '颚', '爪', '目', '角', '翼', '脊', '牙', '爪王', '面者', '瞳'];

function makeBeastName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const n = rng.pick(BEAST_HEAD) + rng.pick(BEAST_TAIL);
    if (!used.has(n)) { used.add(n); return n; }
  }
  return rng.pick(BEAST_HEAD) + rng.pick(BEAST_TAIL) + '二世';
}

/** 生成巨兽：开局放几只，之后偶尔苏醒新的 */
export function spawnBeasts(world: World, count: number): void {
  const rng = new Rng(world.seed ^ 0x9e37);
  const used = new Set<string>(world.beasts.map((b) => b.name));
  for (let i = 0; i < count; i++) {
    // 找一个远离人烟的陆地格
    let x = 0;
    let y = 0;
    for (let t = 0; t < 200; t++) {
      x = 2 + Math.floor(rng.next() * (world.w - 4));
      y = 2 + Math.floor(rng.next() * (world.h - 4));
      const ter = world.terrain[y * world.w + x];
      if (!IS_LAND[ter]) continue;
      // 远离已有城池
      let far = true;
      for (const s of world.settlements) {
        if (!s.alive) continue;
        if (Math.hypot(s.x - x, s.y - y) < 18) { far = false; break; }
      }
      if (far) break;
    }

    const tier = i % 3 === 0 ? 0 : 1;
    const maxHp = tier === 0 ? 260 : 130;
    const b: Beast = {
      id: world.beasts.length,
      name: makeBeastName(rng, used),
      tier,
      x,
      y,
      power: tier === 0 ? 145 : 86,
      hp: maxHp,
      maxHp,
      alive: true,
      kills: 0,
      razed: 0,
      lastAct: world.tick + 420,
      lastSeen: world.year,
      slainBy: -1,
    };
    world.beasts.push(b);
  }
  if (world.beasts.length > 0) {
    const names = world.beasts.filter((b) => b.alive).map((b) => b.name).join('、');
    logEvent(
      world, 'legend',
      `荒野深处有巨兽苏醒：${names}。自此，凡出城者皆结伴而行。`,
      -1, 2,
      { cause: '无人知道它们从何而来，只知它们比城墙更古老' },
    );
  }
}

/** 城防：人口 + 城墙 + 国家科技 */
function cityDefense(world: World, s: Settlement): number {
  let d = s.pop * 0.42 + s.walls * 26 + 24;
  if (s.nation >= 0) {
    const n = world.nations[s.nation];
    if (n) d *= 1 + n.tech * 0.07;
  }
  return d;
}

/**
 * 巨兽挑目标：在视野内找「最弱的城」而不是最近的城。
 * 捕食者不会去啃硬骨头 —— 所以小村会被毁，大城能反杀出英雄。
 */
function preyCity(world: World, b: Beast): Settlement | null {
  let best: Settlement | null = null;
  let bestScore = Infinity;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const d = Math.hypot(s.x - b.x, s.y - b.y);
    if (d > 12) continue;
    // 分数越低越想吃：人口少、城墙薄、距离近
    const score = s.pop * 0.5 + s.walls * 22 + d * 1.6;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  if (best) return best;
  // 附近没有猎物：朝最近的人烟走
  let near: Settlement | null = null;
  let nd = Infinity;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const d = Math.hypot(s.x - b.x, s.y - b.y);
    if (d < nd) { nd = d; near = s; }
  }
  return near;
}

/**
 * 巨兽行动。每 90 tick 动一次 —— 太频繁会变成灾难片，
 * 太稀疏又感觉不到它们存在。90 tick ≈ 9 世界年，正好是「一代人一次的灾」。
 */
export function updateBeasts(world: World): void {
  const rng = new Rng(world.rngState ^ 0x5bd1);

  for (const b of world.beasts) {
    if (!b.alive) continue;
    if (world.tick - b.lastAct < 90) continue;
    b.lastAct = world.tick;

    const target = preyCity(world, b);
    const dist = target ? Math.hypot(target.x - b.x, target.y - b.y) : Infinity;
    if (!target || dist > 11) {
      // 视野内没有城：朝最近的人烟方向走（哪怕还很远）
      if (target) {
        b.x += Math.sign(target.x - b.x) * Math.min(4, Math.abs(target.x - b.x));
        b.y += Math.sign(target.y - b.y) * Math.min(4, Math.abs(target.y - b.y));
        continue;
      }
      // 无城可攻：在荒野游荡，慢慢靠近有人烟的地方
      b.x += Math.round((rng.next() - 0.5) * 6);
      b.y += Math.round((rng.next() - 0.5) * 6);
      b.x = Math.max(1, Math.min(world.w - 2, b.x));
      b.y = Math.max(1, Math.min(world.h - 2, b.y));
      const t = world.terrain[b.y * world.w + b.x];
      if (!IS_LAND[t]) { b.x = Math.max(1, b.x - 3); }
      continue;
    }

    // 已到城下，无需再移动


    // 逼近目标
    b.x += Math.sign(target.x - b.x) * Math.min(3, Math.abs(target.x - b.x));
    b.y += Math.sign(target.y - b.y) * Math.min(3, Math.abs(target.y - b.y));

    const def = cityDefense(world, target);
    // 巨兽战力有波动，避免每次都是同一个结果
    const atk = b.power * (0.7 + rng.next() * 0.7);

    if (atk > def) {
      // ---- 破城 ----
      const lost = Math.round(target.pop * (0.3 + rng.next() * 0.25));
      target.pop = Math.max(6, target.pop - lost);
      b.kills += lost;
      b.lastSeen = world.year;

      // 弃城（矮人要塞里「文明放弃城镇」就是这个）
      // 但一只兽一生最多毁 2 城 —— 否则它会一路清空整片大陆
      const canRaze = b.razed < 2 && (target.pop < 40 || b.tier === 0);
      if (canRaze) {
        b.razed++;
        const ownerName = target.nation >= 0
          ? world.nations[target.nation]?.name ?? ''
          : '独立部落';
        logEvent(
          world, 'disaster',
          `${b.name} 盘踞 ${target.name}，${ownerName} 弃城而走。此城遂为兽巢。`,
          target.race, 2,
          {
            actor: b.name,
            cause: `${b.name} 已毁 ${b.razed} 城，城中再无人敢守`,
          },
        );
        target.ruin = true;
        target.alive = false;
        if (target.nation >= 0) {
          const n = world.nations[target.nation];
          const i = n.cities.indexOf(target.id);
          if (i >= 0) n.cities.splice(i, 1);
        }
        target.nation = -1;
        target.capital = false;
        target.pop = Math.max(4, target.pop * 0.4);
        b.power *= 1.06; // 越吃越强
        b.lastAct = world.tick + 520; // 占巢之后蛰伏
      } else {
        logEvent(
          world, 'disaster',
          `${b.name} 破 ${target.name}，城中死者 ${lost > 900 ? '以千计' : '数百'}。`,
          target.race, 2,
          {
            actor: b.name,
            cause: `${target.name} 城墙不足以拒此物`,
          },
        );
        // 吃饱之后离场，去别处 —— 否则会一直围着一座城反复屠
        b.lastAct = world.tick + 430;
        const ang = rng.next() * Math.PI * 2;
        const jump = 14 + rng.next() * 14;
        b.x = Math.max(1, Math.min(world.w - 2, b.x + Math.round(Math.cos(ang) * jump)));
        b.y = Math.max(1, Math.min(world.h - 2, b.y + Math.round(Math.sin(ang) * jump)));
      }
    } else {
      // ---- 守住了 ----
      b.hp -= def * 0.9;
      if (b.hp <= 0) {
        b.alive = false;
        b.slainBy = target.nation >= 0 ? world.nations[target.nation]?.king ?? -1 : -1;
        const n: Nation | undefined = target.nation >= 0 ? world.nations[target.nation] : undefined;
        const king = n && n.king >= 0 ? world.agents[n.king] : undefined;

        if (king) {
          king.warsWon++;
          king.deeds.push({
            year: Math.round(world.year),
            text: `斩巨兽 ${b.name} 于 ${target.name} 城下`,
            weight: 2,
          });
          king.citiesFounded += 0;
        }
        logEvent(
          world, 'legend',
          `${b.name} 死。${king ? `${king.name} 亲率守军鏖战三日` : '守军'}斩之，全城皆哭，而后大醉三日。`,
          target.race, 2,
          {
            actor: king?.name,
            cause: `${b.name} 此前已杀 ${b.kills} 人`,
            quote: king ? '「它也不是杀不死的。」' : undefined,
          },
        );
      } else if (rng.next() < 0.3) {
        b.lastAct = world.tick + 120;
        logEvent(
          world, 'disaster',
          `${b.name} 攻 ${target.name} 不克，负伤而去。`,
          target.race, 1,
          { actor: b.name, cause: '城中守军死战' },
        );
      }
    }
  }

  world.rngState = rng.s;
}

/** 每隔一段历史，有可能苏醒新的巨兽（让世界不会随时间变安全） */
export function maybeAwakenBeast(world: World): void {
  const alive = world.beasts.filter((b) => b.alive).length;
  if (alive >= 5) return;
  const rng = new Rng(world.rngState ^ 0x77aa);
  const roll = rng.next();
  // 关键：无论是否生成，都必须推进随机状态。
  // 否则每次调用都从同一个 seed 掷骰，结果永远是同一个。
  world.rngState = rng.s;
  if (roll > 0.35) return;

  const before = world.beasts.length;
  spawnBeasts(world, 1);
  if (world.beasts.length > before) {
    const b = world.beasts[world.beasts.length - 1];
    b.lastSeen = world.year;
  }
}
