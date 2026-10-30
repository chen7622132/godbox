/**
 * 小人图鉴：把游戏里真正使用的 paintUnit 放大 4 倍画出来，
 * 验证「游戏里放大后能不能看清」。
 *
 * 用法：node unit-sheet.mjs
 * 输出：/tmp/unit-sheet.png
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { paintUnit, RACE_LOOK_EXPORT } from '../src/render/renderer.ts';

const RACES = ['人类', '精灵', '矮人', '兽人'];
const JOBS = ['soldier', 'farmer', 'wood', 'mine', 'priest', 'child'];
const JOB_CN = { soldier: '士兵', farmer: '农夫', wood: '樵夫', mine: '矿工', priest: '祭司', child: '孩童' };

const H = Number(process.env.UNIT_H ?? 64); // 默认 64（看细节）；21 对应游戏里 zoom=64
const cellW = 150;
const cellH = 150;
const padX = 90;
const padY = 90;

const cw = padX + cellW * JOBS.length;
const ch = padY + cellH * RACES.length + 40;
const canvas = createCanvas(cw, ch);
const ctx = canvas.getContext('2d');

// 背景：中性深绿，避免与任何种族撞色
ctx.fillStyle = '#2b2f38';
ctx.fillRect(0, 0, cw, ch);

ctx.font = 'bold 17px sans-serif';
ctx.fillStyle = '#e8e2d0';
ctx.textAlign = 'center';
for (let j = 0; j < JOBS.length; j++) {
  ctx.fillText(JOB_CN[JOBS[j]], padX + cellW * j + cellW / 2, 48);
}

for (let r = 0; r < RACES.length; r++) {
  const look = RACE_LOOK_EXPORT[r];
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8e2d0';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(RACES[r], 16, padY + cellH * r + cellH / 2);

  for (let j = 0; j < JOBS.length; j++) {
    const cx = padX + cellW * j + cellW / 2;
    const cy = padY + cellH * r + cellH / 2;
    // 格子底
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(cx - 55, cy - 55, 110, 110);
    paintUnit(
      ctx, cx, cy, H, Math.round(H * 0.56 * look.w),
      { race: r, job: JOBS[j], state: 'idle', dir: 0, anim: 0 },
      look, 0,
    );
  }
}

writeFileSync(process.env.OUT ?? '/tmp/unit-sheet.png', canvas.encodeSync('png'));
console.log('→ /tmp/unit-sheet.png  (' + cw + 'x' + ch + ') 每个单位 H=' + H + 'px');
