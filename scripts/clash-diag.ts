import { generateWorld } from '../src/core/world';
import { seedRaces } from '../src/sim/seed';
import { stepWorld } from '../src/sim/simulation';
import { formGarrison } from '../src/sim/units';

const world = generateWorld({ size: 'medium', seed: 20261030, landRatio: 0.45, fragmentation: 0.35 });
seedRaces(world, [0, 1, 2, 3]);

let seen = false;
let id = -1;
for (let i = 0; i < 4000; i++) {
  stepWorld(world);
  const c = world.armies.find((a) => a.state === 'clash');
  if (c && !seen) {
    seen = true;
    id = c.id;
    console.log(`tick ${world.tick} 进入交战：军${c.id} 攻/守=${c.kind} 人=${c.units.length} 目标城=${c.to}`);
    const city = world.settlements[c.to];
    console.log(`  目标城 nation=${city?.nation} alive=${city?.alive} | 场上军队：` +
      world.armies.map((a) => `${a.id}:${a.kind}:${a.units.length}`).join(', ') +
      ` | 军队数=${world.armies.length}`);
  }
  if (seen && world.tick % 40 === 0) {
    const a = world.armies.find((x) => x.id === id);
    if (!a) {
      console.log(`tick ${world.tick} 军队已消失`);
      break;
    }
    const def = world.armies.find((d) => d.kind === 'defend' && d.to === a.to);
    if (def && !(globalThis as any).__dg) {
      (globalThis as any).__dg = 1;
      const au = world.units.filter((u) => u.army === a.id);
      const du = world.units.filter((u) => u.army === def.id);
      let md = 99;
      for (const x of au) for (const y of du) md = Math.min(md, Math.hypot(x.x - y.x, x.y - y.y));
      const roles: Record<string, number> = {};
      for (const x of au) roles[x.role ?? '?'] = (roles[x.role ?? '?'] ?? 0) + 1;
      const archers = au.filter((x) => x.role === 'archer');
      const da = archers[0]
        ? Math.min(...du.map((y) => Math.hypot(archers[0].x - y.x, archers[0].y - y.y)))
        : -1;
      console.log(`  两军最近距离=${md.toFixed(2)} 攻方${JSON.stringify(roles)} 弓手到敌=${da.toFixed(2)} state=${archers[0]?.state} army=${archers[0]?.army}`);
    }
    console.log(
      `tick ${world.tick} 军${a.id} ${a.state} 人=${a.units.length} 力=${(a.strength * 100) | 0}% resolved=${a.resolved} ` +
      `| 守 ${def ? `${def.units.length}人 ${(def.strength * 100) | 0}% init=${def.initial} state=${def.state}` : '无'} ` +
      `| 尸=${world.corpses.length} 箭活=${world.arrows.filter((x) => x.active).length}/池${world.arrows.length} 火=${world.sparks.length}`,
    );
  }
}

const t = world.settlements.find((s) => s.alive && !s.ruin && s.nation >= 0);
if (t) {
  const g = formGarrison(world, t.id, t.x - 4, t.y - 2);
  console.log('直接调用 formGarrison ->', g ? `ok 人=${g.units.length} nation=${g.nation}` : 'null', '城', t.id, t.name);
}
