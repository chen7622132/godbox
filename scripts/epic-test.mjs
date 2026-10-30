import { generateWorld } from '../src/core/world.ts';
import { seedRaces } from '../src/sim/seed.ts';
import { stepWorld } from '../src/sim/simulation.ts';
import { buildChronicle } from '../src/core/epic.ts';

const world = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261030), landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);
const ticks = Number(process.env.TICKS ?? 6000);
for (let i = 0; i < ticks; i++) stepWorld(world);

const chapters = buildChronicle(world);
console.log(`\n=== 共 ${chapters.length} 卷 ===\n`);
for (const c of chapters) {
  console.log(`【${c.title}】`);
  for (const l of c.lines) console.log('  ' + l);
  console.log('');
}
