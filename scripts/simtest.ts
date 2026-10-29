/**
 * 离线模拟测试：不依赖浏览器，跑 9000 tick 看节奏对不对。
 * 用法：npx esbuild scripts/simtest.ts --bundle --platform=node --format=esm --outfile=/tmp/simtest.mjs && node /tmp/simtest.mjs
 */
import { generateWorld } from '../src/core/world';
import { stepWorld } from '../src/sim/simulation';
import { updateFire, updatePlague } from '../src/sim/disasters';
import { seedRaces } from '../src/sim/seed';
import type { World } from '../src/core/types';

const SEEDS = [20261029, 777, 12345, 88888];
const RACESET = [0, 3];

interface RunResult {
  seed: number;
  nationTick: number;
  warTick: number;
  conquerTick: number;
  endTick: number;
  reason: string;
  peakPop: number;
  cities: number;
  nations: number;
  wars: number;
  battles: number;
}

function run(seed: number, verbose: boolean): RunResult {
  const world: World = generateWorld({
    size: 'medium', seed, landRatio: 0.45, fragmentation: 0.35,
  });
  seedRaces(world, RACESET);

  const marks = { nation: -1, war: -1, conquer: -1 };
  let endTick = -1;

  for (let i = 0; i < 9000; i++) {
    stepWorld(world);
    if (world.tick % 3 === 0) updateFire(world);
    if (world.tick % 12 === 0) updatePlague(world);

    if (marks.nation < 0 && world.nations.length > 0) marks.nation = world.tick;
    if (marks.war < 0 && world.stats.warsDeclared > 0) marks.war = world.tick;
    if (marks.conquer < 0 && world.events.some((e) => e.kind === 'conquer')) marks.conquer = world.tick;
    if (world.ended) { endTick = world.tick; break; }

    if (verbose && world.tick % 900 === 0) {
      const pop = world.settlements.filter((s) => s.alive && !s.ruin).reduce((a, s) => a + s.pop, 0);
      const cities = world.settlements.filter((s) => s.alive && !s.ruin).length;
      const nations = world.nations.filter((n) => n.alive).length;
      console.log(
        `  tick ${String(world.tick).padStart(5)} | 人口 ${String(Math.round(pop)).padStart(5)}` +
        ` | 城 ${String(cities).padStart(2)} | 国 ${nations} | 战 ${world.stats.warsDeclared} | 役 ${world.stats.battles}`,
      );
    }
  }

  const cities = world.settlements.filter((s) => s.alive && !s.ruin);
  if (verbose) {
    console.log('\n  --- 关键节点 ---', marks, '结束tick', endTick);
    console.log('  结局:', world.ended ? world.endReason : '未结束');
    console.log('  --- 大事记 ---');
    for (const e of world.events.filter((e) => e.level >= 2).slice(0, 26)) {
      console.log(`  [${Math.round(e.year)}] ${e.text}`);
    }
  }

  return {
    seed,
    nationTick: marks.nation,
    warTick: marks.war,
    conquerTick: marks.conquer,
    endTick,
    reason: world.ended ? world.endReason : '未结束',
    peakPop: Math.round(world.stats.peakPop),
    cities: cities.length,
    nations: world.nations.filter((n) => n.alive).length,
    wars: world.stats.warsDeclared,
    battles: world.stats.battles,
  };
}

console.log('=== 详细跑一局（seed 20261029）===');
run(SEEDS[0], true);

console.log('\n=== 多种子对比 ===');
const rows: RunResult[] = SEEDS.map((s) => run(s, false));
for (const r of rows) {
  console.log(
    `seed ${String(r.seed).padStart(9)} | 建国 ${String(r.nationTick).padStart(5)}` +
    ` | 首战 ${String(r.warTick).padStart(5)} | 首陷 ${String(r.conquerTick).padStart(5)}` +
    ` | 结束 ${String(r.endTick).padStart(5)} | 峰值人口 ${String(r.peakPop).padStart(6)}` +
    ` | 城 ${String(r.cities).padStart(2)} | 国 ${r.nations} | 战 ${String(r.wars).padStart(2)}` +
    ` | 役 ${String(r.battles).padStart(3)} | ${r.reason}`,
  );
}
