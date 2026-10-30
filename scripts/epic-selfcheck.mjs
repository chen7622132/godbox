import { generateWorld } from '../src/core/world.ts';
import { seedRaces } from '../src/sim/seed.ts';
import { stepWorld } from '../src/sim/simulation.ts';
import { buildChronicle } from '../src/core/epic.ts';

const SEEDS = [20261030, 777, 4242, 20260101];
const TICKS = 7000;

// 硬性禁令：这些句式一旦出现，史诗感立刻塌成宣传稿
const BANNED = ['历史证明', '告诉我们', '从此以后', '务必', '伟大', '辉煌', '可歌可泣'];
const OPENING_BAN = /^第?[一二三四五六七八九十百千0-9]+年/;

let totalLines = 0;
let bannedHits = 0;
const dup = new Map();
let causal = 0;
let sensory = 0;
let charCount = 0;

const SENSE = ['雨', '风', '雪', '雾', '日头', '冰', '铁锈', '血', '焦', '光', '声', '哭', '鼓', '号角', '味'];

for (const seed of SEEDS) {
  const world = generateWorld({ size: 'medium', seed, landRatio: 0.45, fragmentation: 0.35 });
  seedRaces(world, [0, 1, 2, 3]);
  for (let i = 0; i < TICKS; i++) stepWorld(world);
  const ch = buildChronicle(world);
  const names = world.nations.map((n) => n.name);
  let badAnchor = 0;
  for (const c of ch) {
    for (const l of c.lines) {
      totalLines++;
      charCount += l.length;
      for (const b of BANNED) if (l.includes(b)) bannedHits++;
      if (OPENING_BAN.test(l)) bannedHits++;
      // 因果句：包含「账」「因」「于是」「所以」「为」「仇」等
      if (/账|仇|为|于是|所以|因|才|便/.test(l)) causal++;
      // 感官：至少命中两个不同感官词
      // 按「段」算：连续两句算一段，整段命中 2 种以上感官即达标（符合用户口径：每段两种感官）
      const hit = new Set(SENSE.filter((s) => l.includes(s)));
      const prev = c.lines[c.lines.indexOf(l) - 1] ?? '';
      const hit2 = new Set(SENSE.filter((s) => (l + prev).includes(s)));
      if (hit.size >= 2 || hit2.size >= 2) sensory++;
      dup.set(l, (dup.get(l) ?? 0) + 1);
    }
    // 事实锚点：章节里出现的「XX 覆灭」国名必须在 nations 里
    const m = c.lines.join('').match(/([\u4e00-\u9fa5]{2,3}) 覆灭/g) ?? [];
    for (const one of m) {
      const n = one.replace(' 覆灭', '');
      if (!names.includes(n)) badAnchor++;
    }
  }
}
const repeated = [...dup.entries()].filter(([, n]) => n > 1);
const worst = repeated.sort((a, b) => b[1] - a[1]).slice(0, 4);

console.log('=== 史书自检（4 个种子 × 7000 tick） ===');
console.log('总句数            ', totalLines);
console.log('平均句长          ', (charCount / totalLines).toFixed(1), '字');
console.log('禁词/年份开头命中 ', bannedHits, '（要求 0）');
console.log('因果句占比        ', ((causal / totalLines) * 100).toFixed(0) + '%');
console.log('双感官句占比      ', ((sensory / totalLines) * 100).toFixed(0) + '%');
console.log('重复句种类        ', repeated.length, '/', dup.size);
console.log('最高重复          ', worst.map(([t, n]) => `「${t.slice(0, 14)}…」×${n}`).join(' | ') || '无');
