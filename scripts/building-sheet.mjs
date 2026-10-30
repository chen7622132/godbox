/**
 * 建筑图鉴：用游戏里同一个 paintStruct 画出来，
 * 尺寸取「游戏里 zoom=64 时的真实像素」——这才是玩家看到的。
 *
 * 用法：UNIT=64 node/sheet
 * 输出：/tmp/building-sheet.png
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { paintStruct } from '../src/render/renderer.ts';
import { RACES } from '../src/core/races.ts';

const U = Number(process.env.UNIT ?? 64); // 每格像素数（游戏里最大 64）
const RACE_CN = ['人类', '精灵', '矮人', '兽人'];

const KINDS = [
  { key: 'house', w: 0.95, h: 0.92 },
  { key: 'workshop', w: 1.05, h: 0.95 },
  { key: 'granary', w: 0.92, h: 1.05 },
  { key: 'temple', w: 1.1, h: 1.3 },
  { key: 'barracks', w: 1.15, h: 1.0 },
  { key: 'tower', w: 0.7, h: 1.55 },
];
const KIND_CN = ['民居', '工坊', '粮仓', '神庙', '兵营', '瞭望塔'];

const cellW = Math.round(U * 2.2);
const cellH = Math.round(U * 2.4);
const padX = 110;
const padY = 90;

const cw = padX + cellW * KINDS.length;
const ch = padY + cellH * 4 + 30;
const canvas = createCanvas(cw, ch);
const ctx = canvas.getContext('2d');

// 草地背景：和真实游戏一致，才能看出可读性
ctx.fillStyle = '#4d7c42';
ctx.fillRect(0, 0, cw, ch);
// 淡淡的格线，帮助判断尺寸
ctx.strokeStyle = 'rgba(255,255,255,0.07)';
for (let x = 0; x < cw; x += U) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
for (let y = 0; y < ch; y += U) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }

ctx.font = 'bold 17px sans-serif';
ctx.fillStyle = '#f2ecd8';
ctx.textAlign = 'center';
for (let j = 0; j < KINDS.length; j++) {
  ctx.fillText(KIND_CN[j], padX + cellW * j + cellW / 2, 52);
}

function shade(rgb, k) {
  return `rgb(${Math.min(255, Math.round(rgb[0] * k))},${Math.min(255, Math.round(rgb[1] * k))},${Math.min(255, Math.round(rgb[2] * k))})`;
}

const WALL = ['#f4ecd6', '#e6dcc0', '#9a9a94', '#7a5f42'];
const WALL_DIM = ['#dcd0b8', '#cfc3a4', '#8a8a84', '#6b523a'];

for (let r = 0; r < 4; r++) {
  const rgb = RACES[r].rgb ?? [200, 200, 200];
  const roof = shade(rgb, 0.98);
  const roofDark = shade(rgb, 0.6);

  ctx.textAlign = 'left';
  ctx.font = 'bold 19px sans-serif';
  ctx.fillStyle = '#f2ecd8';
  ctx.fillText(RACE_CN[r], 14, padY + cellH * r + cellH / 2 + 6);

  for (let j = 0; j < KINDS.length; j++) {
    const k = KINDS[j];
    const cx = padX + cellW * j + cellW / 2;
    const cy = padY + cellH * r + cellH / 2;
    const w = Math.round(U * k.w);
    const h = Math.round(U * k.h);

    let opts;
    if (k.key === 'house') {
      opts = {
        race: r, wall: WALL[r], roof, roofDark,
        roofType: (r === 1 ? 'tree' : r === 2 ? 'flat' : r === 3 ? 'dome' : 'gable'),
        addons: r === 2 ? ['chimney'] : [],
        lit: true,
      };
    } else if (k.key === 'workshop') {
      opts = {
        race: r, wall: WALL_DIM[r], roof, roofDark,
        roofType: (r === 2 ? 'flat' : 'gable'),
        addons: ['belfry', 'goods'], lit: true,
      };
    } else if (k.key === 'granary') {
      opts = {
        race: r, wall: WALL[r], roof: '#d6b25c', roofDark: '#aa8a42',
        roofType: 'dome', addons: ['goods'], lit: false,
      };
    } else if (k.key === 'temple') {
      opts = {
        race: r, wall: WALL[r], roof: '#e8e2cc', roofDark: '#b8b09a',
        roofType: (r === 2 ? 'flat' : 'spire'), addons: [(r === 3 ? 'horns' : 'cross')], lit: true,
      };
    } else if (k.key === 'barracks') {
      opts = {
        race: r, wall: WALL_DIM[r], roof: roofDark, roofDark: shade(rgb, 0.42),
        roofType: (r === 2 ? 'flat' : 'gable'),
        addons: ['banner', 'shield', 'crenel'], lit: true,
      };
    } else {
      opts = {
        race: r, wall: WALL[r], roof, roofDark,
        roofType: 'flat', addons: ['banner'], lit: true,
      };
    }

    paintStruct(ctx, cx, cy, w, h, opts);
  }
}

writeFileSync(process.env.OUT ?? '/tmp/building-sheet.png', canvas.encodeSync('png'));
console.log('→ ' + (process.env.OUT ?? '/tmp/building-sheet.png') + '  (' + cw + 'x' + ch + ')  每格 ' + U + 'px');
