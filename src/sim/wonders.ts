import { Rng } from '../core/rng';
import { logEvent } from '../core/events';
import type { World, Wonder, Nation } from '../core/types';

/**
 * 四座世界奇观，一国一座，全球唯一。
 *
 * 设计参考《文明6》：奇观的意义不在数值，而在它把「发展」变成
 * 一场所有人都看得见的竞赛 —— 谁先建成，谁就在编年史上多一行字。
 * 而且建造期间城邦极脆弱，这给了对手「趁你大兴土木时打你」的动机。
 */
export const WONDER_DEF: {
  kind: number;
  name: string;
  title: string;
  desc: string;
  effect: string;
}[] = [
  {
    kind: 0,
    name: '万卷之城',
    title: '人类的大图书馆',
    desc: '无数抄写员在长廊里誊抄各地典籍，火光彻夜不熄。',
    effect: '科技速度 +50%',
  },
  {
    kind: 1,
    name: '月桂母树',
    title: '精灵的世界之树',
    desc: '一棵树长到云里，根须连起整片森林，据说它记得所有死去的名字。',
    effect: '人口上限 +25%，森林中战力大增',
  },
  {
    kind: 2,
    name: '深炉',
    title: '矮人的地心熔炉',
    desc: '他们向下挖了三代人的时间，只为让炉火离地心更近一尺。',
    effect: '全军战力 +20%，城墙更坚',
  },
  {
    kind: 3,
    name: '万骨塔',
    title: '兽人的骨山',
    desc: '每一根骨头都是一场胜仗的记数。它越高，他们越不怕死。',
    effect: '侵略性大增，战时人口反而增长',
  },
];

/** 该奇观是否已建成 */
export function hasWonder(world: World, kind: number): boolean {
  return world.wonders.some((w) => w.kind === kind && w.built);
}

/** 造这座奇观的国家（-1 表示没有） */
export function wonderOwner(world: World, kind: number): number {
  const w = world.wonders.find((x) => x.kind === kind && x.built);
  return w ? w.nation : -1;
}

/** 国境内是否有正在建造的奇观 */
export function buildingWonder(world: World, nid: number): Wonder | undefined {
  return world.wonders.find((w) => w.nation === nid && !w.built && !w.ruined);
}

function biggestCity(world: World, n: Nation): number {
  let best = -1;
  let bestPop = 0;
  for (const id of n.cities) {
    const s = world.settlements[id];
    if (!s || !s.alive || s.ruin) continue;
    if (s.pop > bestPop) { bestPop = s.pop; best = id; }
  }
  return best;
}

/**
 * 每 40 tick 检查一次：谁够格开工、谁的工程推进到哪了。
 */
export function updateWonders(world: World): void {
  const rng = new Rng(world.rngState ^ 0x3f11);

  // ---- 1. 开工判定 ----
  for (const n of world.nations) {
    if (!n.alive) continue;
    const d = WONDER_DEF[n.race];
    if (!d) continue;
    if (world.wonders.some((w) => w.kind === n.race && !w.ruined)) continue; // 已有人造/在建
    if (n.cities.length < 3) continue;
    if (n.tech < 2) continue;
    if (!rng.chance(0.12)) continue;

    const city = biggestCity(world, n);
    if (city < 0) continue;
    const s = world.settlements[city];

    world.wonders.push({
      kind: n.race,
      name: d.name,
      nation: n.id,
      city,
      progress: 0,
      built: false,
      started: Math.round(world.year),
      finished: 0,
      ruined: false,
    });

    logEvent(
      world, 'legend',
      `${n.name} 于 ${s.name} 动工兴建${d.title}。举国之力，皆为此一物。`,
      n.race, 2,
      {
        actor: n.king >= 0 ? world.agents[n.king]?.name : undefined,
        cause: `${n.name} 已有 ${n.cities.length} 城、科技至 ${n.tech} 级，足以供养此工`,
        quote: '「我们这辈子看不到它建成。但我们的孙子会。」',
      },
    );
  }

  // ---- 2. 推进 ----
  for (const w of world.wonders) {
    if (w.built || w.ruined) continue;
    const s = world.settlements[w.city];
    const n = world.nations[w.nation];

    // 城没了 / 国亡了 / 城被夺走 → 半途而废
    if (!s || !s.alive || s.ruin || !n || !n.alive || s.nation !== n.id) {
      w.ruined = true;
      logEvent(
        world, 'disaster',
        `${w.name} 半途而废。未成的石料散在野地里，此后无人再提。`,
        n?.race ?? -1, 2,
        { cause: `工地已不属于 ${n?.name ?? '原主'}` },
      );
      continue;
    }

    // 建造靠人口，也靠时间
    // 本函数每 40 tick 才走一次，所以这里的系数已经含了 40 倍
    const speed = (s.pop / 300) * 0.013;
    w.progress = Math.min(1, w.progress + speed);

    if (w.progress >= 1) {
      w.built = true;
      w.finished = Math.round(world.year);
      const king = n.king >= 0 ? world.agents[n.king] : undefined;
      const def = WONDER_DEF[w.kind];
      if (king) {
        king.deeds.push({
          year: Math.round(world.year),
          text: `成${def.name}，为当世第一`,
          weight: 2,
        });
      }
      logEvent(
        world, 'legend',
        `${def.title}落成于 ${s.name}，历 ${w.finished - w.started} 年。${def.desc}`,
        n.race, 2,
        {
          actor: king?.name,
          cause: `${n.name} 倾三代人之力`,
          quote: '「它还在。我们大多不在了。」',
        },
      );
    }
  }

  world.rngState = rng.s;
}

/** 奇观给国家的加成（每项都很直白，方便调参） */
export function wonderBuff(world: World, n: Nation): {
  tech: number;
  cap: number;
  power: number;
  aggression: number;
} {
  const own = (k: number) => wonderOwner(world, k) === n.id;
  return {
    tech: own(0) ? 1.32 : 1,
    cap: own(1) ? 1.25 : 1,
    power: own(2) ? 1.2 : 1,
    aggression: own(3) ? 1.5 : 1,
  };
}

/** 已建成的奇观（渲染用） */
export function wonderList(world: World): Wonder[] {
  return world.wonders.filter((w) => w.built);
}
