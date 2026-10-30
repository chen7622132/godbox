import { generateWorld } from '../src/core/world.ts';
import { seedRaces } from '../src/sim/seed.ts';
import { stepWorld } from '../src/sim/simulation.ts';
import { buildChronicle } from '../src/core/epic.ts';
import { renderEpic } from './epic-render.mjs';

const world = generateWorld({ size: 'medium', seed: Number(process.env.SEED ?? 20261030), landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);
for (let i = 0; i < Number(process.env.TICKS ?? 7000); i++) stepWorld(world);
const ch = buildChronicle(world);
const { w, h } = renderEpic(ch, '/tmp/epic-sheet.png');
console.log(`渲染完成 ${w}x${h}，${ch.length} 卷`);
