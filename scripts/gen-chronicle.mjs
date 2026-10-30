import { generateWorld } from '../src/core/world.ts';
import { seedRaces } from '../src/sim/seed.ts';
import { stepWorld } from '../src/sim/simulation.ts';

const world = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261029), landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);

const TICKS = Number(process.env.TICKS ?? 6000);
for (let i = 0; i < TICKS; i++) stepWorld(world);

console.log(`=== tick=${world.tick} 城=${world.settlements.filter(s => s.alive && !s.ruin).length} 国=${world.nations.filter(n => n.alive).length} ===\n`);

// 只打 level>=1 的，模拟玩家看编年史
const important = world.events.filter((e) => e.level >= 1);
console.log(`重要事件 ${important.length} 条 / 全部 ${world.events.length} 条\n`);

for (const e of important.slice(-60)) {
  const tag = e.kind.padEnd(8);
  let line = `[${e.year}] ${tag} ${e.text}`;
  if (e.cause) line += `\n          ⌐ 因：${e.cause}`;
  if (e.quote) line += `\n          「${e.quote}」`;
  console.log(line);
}

// 人物列传抽样
console.log('\n===== 列传抽样 =====');
const dead = world.agents.filter((a) => !a.alive && a.deeds.length >= 2).sort((a, b) => b.popSlain - a.popSlain);
for (const k of dead.slice(0, 3)) {
  console.log(`\n【${k.name}】${k.epithet ? '「' + k.epithet + '」' : ''}  ${k.traits.join('·')}  志：${k.ambition}`);
  console.log(`  生 ${k.born} — 卒 ${k.diedYear ?? '今'}，${k.cause ?? ''}`);
  for (const d of k.deeds.slice(0, 6)) console.log(`  · [${d.year}] ${d.text}`);
}
