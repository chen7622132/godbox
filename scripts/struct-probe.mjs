/** 单栋建筑特写：直接调 paintStruct，放大 8 倍看细节。 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { paintStruct } from '../src/render/renderer.ts';

const Z = 6;
const cell = 80;
const specs = [
  { race: 0, wall: '#f4ecd6', roof: '#c85a3a', roofDark: '#8a3a24', roofType: 'gable', addons: ['chimney'], lit: true },
  { race: 1, wall: '#e6dcc0', roof: '#4a8f5e', roofDark: '#2f6b40', roofType: 'tree', addons: [], lit: false },
  { race: 2, wall: '#9a9a94', roof: '#8a6a3a', roofDark: '#5e4526', roofType: 'flat', addons: ['chimney', 'goods'], lit: true },
  { race: 3, wall: '#7a5f42', roof: '#a83d3d', roofDark: '#6d2424', roofType: 'dome', addons: ['banner', 'shield'], lit: false },
];

const out = createCanvas(cell * Z * specs.length, cell * Z);
const og = out.getContext('2d');
og.imageSmoothingEnabled = false;
og.fillStyle = '#6ea34f';
og.fillRect(0, 0, out.width, out.height);

const tmp = createCanvas(cell, cell);
const tg = tmp.getContext('2d');

specs.forEach((sp, i) => {
  tg.clearRect(0, 0, cell, cell);
  paintStruct(tg, cell / 2, cell / 2, 46, 46, sp);
  og.drawImage(tmp, 0, 0, cell, cell, i * cell * Z, 0, cell * Z, cell * Z);
});

writeFileSync('/tmp/struct-probe.png', await out.encode('png'));
console.log('→ /tmp/struct-probe.png');
