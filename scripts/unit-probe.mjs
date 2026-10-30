/**
 * 单个角色特写：按游戏真实尺寸绘制，再最近邻放大 8 倍看像素。
 * 用法：RACE=0 H=22 node unit-probe.mjs
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { paintUnit, RACE_LOOK_EXPORT } from '../src/render/renderer.ts';

globalThis.document = { createElement: () => createCanvas(1, 1) };

const RACE = Number(process.env.RACE ?? 0);
const H = Number(process.env.H ?? 22);
const JOBS = (process.env.JOBS ?? 'melee_archer_general,farmer,wood,mine,priest,child').split(',');
const ROLES = (process.env.ROLES ?? 'melee,archer,general').split(',');
const Z = 8;
const cell = 90;

const out = createCanvas(cell * Z * JOBS.length, cell * Z * ROLES.length);
const og = out.getContext('2d');
og.imageSmoothingEnabled = false;
og.fillStyle = '#6ea34f';
og.fillRect(0, 0, out.width, out.height);

const tmp = createCanvas(cell, cell);
const tg = tmp.getContext('2d');

for (let r = 0; r < ROLES.length; r++) {
  for (let c = 0; c < JOBS.length; c++) {
    tg.clearRect(0, 0, cell, cell);
    const look = RACE_LOOK_EXPORT[RACE];
    paintUnit(tg, cell / 2, cell / 2 + 22, H, Math.round(H * 0.56 * look.w), {
      race: RACE,
      job: JOBS[c].startsWith('melee') ? 'soldier' : JOBS[c],
      state: 'idle',
      dir: 2,
      anim: 0,
      role: JOBS[c].startsWith('melee') ? ROLES[r] : undefined,
    }, look, 0, '#c8492f');
    og.drawImage(tmp, 0, 0, cell, cell, c * cell * Z, r * cell * Z, cell * Z, cell * Z);
  }
}

writeFileSync('/tmp/unit-probe.png', await out.encode('png'));
console.log('→ /tmp/unit-probe.png', `${JOBS.length}列 × ${ROLES.length}行，H=${H}，放大${Z}倍`);
