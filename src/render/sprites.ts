/**
 * 装饰精灵：树、岩石、草丛。
 *
 * 关键设计：这些精灵**跨格**绘制（一棵树占 2~3 格），而不是每格塞一个图案。
 * 之前把图案烘焙进每一格，视觉上就成了"瓷砖"，无论多精细都会显得假。
 */

export interface Sprite {
  w: number;
  h: number;
  /** ABGR，alpha=0 表示透明 */
  data: Uint32Array;
}

export function packPx(r: number, g: number, b: number, a = 255): number {
  const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return ((a << 24) | (bi << 16) | (gi << 8) | ri) >>> 0;
}

function h2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type RGB = [number, number, number];

/**
 * 一棵树：椭圆树冠 + 树干，右下方向有投影，边缘用噪声打毛避免"完美圆形"。
 * variant 控制树冠胖瘦，让同一片森林里的树不完全一样。
 */
export function genTree(
  size: number,
  leaf: RGB,
  trunk: RGB,
  seed: number,
  variant = 0,
): Sprite {
  const s = size;
  const data = new Uint32Array(s * s).fill(0);
  const cx = s * 0.5 + (variant - 1) * s * 0.06;
  const cy = s * 0.4;
  const rx = s * (0.38 + (variant % 3) * 0.03);
  const ry = s * (0.3 + ((variant + 1) % 3) * 0.03);

  // --- 投影（先画，会被树冠盖住一部分）---
  const shadowCx = cx + s * 0.14;
  const shadowCy = cy + s * 0.2;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - shadowCx) / (rx * 1.05);
      const dy = (y - shadowCy) / (ry * 0.95);
      if (dx * dx + dy * dy < 1) {
        data[y * s + x] = packPx(0, 0, 0, 130);
      }
    }
  }

  // --- 树干 ---
  const tw = Math.max(1, Math.round(s * 0.13));
  const tTop = Math.round(s * 0.52);
  for (let y = tTop; y < s - Math.max(1, Math.round(s * 0.04)); y++) {
    const wob = Math.round(Math.sin(y * 0.9) * 0.4);
    for (let x = 0; x < tw; x++) {
      const px = Math.round(cx - tw / 2) + x + wob;
      if (px < 0 || px >= s) continue;
      const shadeK = 0.62 + (x / tw) * 0.5;
      data[y * s + px] = packPx(trunk[0] * shadeK, trunk[1] * shadeK, trunk[2] * shadeK);
    }
  }

  // --- 树冠 ---
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      // 边缘噪声：让轮廓不规则
      const edge = h2(x * 13 + seed, y * 17 + seed) * 0.42;
      if (d + edge > 1) continue;
      // 受光：左上亮、右下暗
      const light = 0.62 + (1 - (dx * 0.5 + dy * 0.5 + 0.5)) * 0.75;
      const grain = (h2(x * 3 + seed, y * 7 + seed) - 0.5) * 0.22;
      const k = Math.max(0.35, light + grain);
      data[y * s + x] = packPx(leaf[0] * k, leaf[1] * k, leaf[2] * k);
    }
  }

  // --- 树冠顶部高光点 ---
  for (let k = 0; k < Math.max(2, s / 6); k++) {
    const ax = Math.round(cx - rx * 0.4 + h2(seed + k, 5) * rx * 0.7);
    const ay = Math.round(cy - ry * 0.5 + h2(seed + k, 9) * ry * 0.6);
    if (ax >= 0 && ax < s && ay >= 0 && ay < s && data[ay * s + ax] !== 0) {
      data[ay * s + ax] = packPx(leaf[0] * 1.5, leaf[1] * 1.5, leaf[2] * 1.45);
    }
  }

  return { w: s, h: s, data };
}

/** 一块岩石：不规则多边形 + 左上受光、右下背光，底下带投影 */
export function genRock(size: number, rock: RGB, seed: number): Sprite {
  const s = size;
  const data = new Uint32Array(s * s).fill(0);
  const cx = s * 0.5;
  const cy = s * 0.52;
  const rx = s * 0.4;
  const ry = s * 0.32;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      const edge = h2(x * 11 + seed, y * 19 + seed) * 0.5;
      if (d + edge > 1) continue;
      const light = 0.7 + (1 - (dx * 0.6 + dy * 0.6 + 0.5)) * 0.7;
      const k = Math.max(0.4, light + (h2(x * 5 + seed, y * 3) - 0.5) * 0.18);
      data[y * s + x] = packPx(rock[0] * k, rock[1] * k, rock[2] * k);
    }
  }
  // 底部阴影
  for (let x = 0; x < s; x++) {
    for (let y = Math.round(cy + ry * 0.7); y < s; y++) {
      if (data[y * s + x] === 0 && h2(x, y * 3 + seed) > 0.35) {
        data[y * s + x] = packPx(0, 0, 0, 70);
      }
    }
  }
  return { w: s, h: s, data };
}

/** 一丛草/灌木：几个向上的小尖 */
export function genBush(size: number, leaf: RGB, seed: number): Sprite {
  const s = size;
  const data = new Uint32Array(s * s).fill(0);
  const blades = Math.max(3, Math.round(s / 3));
  for (let k = 0; k < blades; k++) {
    const bx = Math.round(s * (0.25 + h2(seed, k) * 0.5));
    const bh = Math.max(2, Math.round(s * (0.3 + h2(seed + 5, k) * 0.35)));
    const baseY = s - 1;
    for (let i = 0; i < bh; i++) {
      const y = baseY - i;
      const lean = Math.round(Math.sin((i / bh) * 1.6) * 0.8);
      const x = bx + lean;
      if (y < 0 || x < 0 || x >= s) continue;
      const k2 = 0.6 + (1 - i / bh) * 0.7;
      data[y * s + x] = packPx(leaf[0] * k2, leaf[1] * k2, leaf[2] * k2);
    }
  }
  return { w: s, h: s, data };
}

/** 一片水洼（沼泽用） */
export function genPuddle(size: number, water: RGB, seed: number): Sprite {
  const s = size;
  const data = new Uint32Array(s * s).fill(0);
  const cx = s / 2;
  const cy = s / 2;
  const rx = s * 0.42;
  const ry = s * 0.28;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      const edge = h2(x * 7 + seed, y * 9 + seed) * 0.4;
      if (d + edge > 1) continue;
      const k = 0.8 + (1 - d) * 0.5;
      data[y * s + x] = packPx(water[0] * k, water[1] * k, water[2] * k);
    }
  }
  return { w: s, h: s, data };
}

/** 把精灵叠加到目标缓冲上，坐标可越界（自动裁剪） */
export function blit(
  buf: Uint32Array,
  bufW: number,
  bufH: number,
  sp: Sprite,
  dx: number,
  dy: number,
): void {
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const x1 = Math.min(sp.w, bufW - dx);
  const y1 = Math.min(sp.h, bufH - dy);
  for (let y = y0; y < y1; y++) {
    const srcRow = y * sp.w;
    const dstRow = (dy + y) * bufW;
    for (let x = x0; x < x1; x++) {
      const c = sp.data[srcRow + x];
      const a = (c >>> 24) & 255;
      if (a === 0) continue;
      if (a === 255) {
        buf[dstRow + dx + x] = c;
      } else {
        // 半透明（投影）简单混合
        const d = buf[dstRow + dx + x];
        const da = (d >>> 24) & 255;
        const dr = d & 255;
        const dg = (d >>> 8) & 255;
        const db = (d >>> 16) & 255;
        const sr = c & 255;
        const sg = (c >>> 8) & 255;
        const sb = (c >>> 16) & 255;
        const k = a / 255;
        buf[dstRow + dx + x] = packPx(
          sr * k + dr * (1 - k),
          sg * k + dg * (1 - k),
          sb * k + db * (1 - k),
          Math.max(da, a),
        );
      }
    }
  }
}
