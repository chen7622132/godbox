import { Rng } from './rng';
import { T, WORLD_SIZES, type World, type WorldSizeKey } from './types';

// ============ 噪声 ============

function lattice(rng: Rng, gw: number, gh: number): Float32Array {
  const a = new Float32Array(gw * gh);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
}

/** 单点值噪声：给地形边缘加扰动用（0..1） */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) => {
    let n = Math.imul(a * 374761393 + b * 668265263 + seed * 1442695041, 1274126177);
    n = n ^ (n >>> 13);
    return ((n >>> 0) % 100000) / 100000;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleBilinear(
  lat: Float32Array, gw: number, gh: number, u: number, v: number,
): number {
  const x0 = Math.min(gw - 1, Math.max(0, Math.floor(u)));
  const y0 = Math.min(gh - 1, Math.max(0, Math.floor(v)));
  const x1 = Math.min(gw - 1, x0 + 1);
  const y1 = Math.min(gh - 1, y0 + 1);
  const fx = smooth(u - x0);
  const fy = smooth(v - y0);
  const a = lat[y0 * gw + x0];
  const b = lat[y0 * gw + x1];
  const c = lat[y1 * gw + x0];
  const d = lat[y1 * gw + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** 分形噪声，返回 0..1 */
export function fbm(w: number, h: number, rng: Rng, octaves = 5): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 2 << o; // 2,4,8,16,32…
    const gw = cells + 1;
    const gh = cells + 1;
    const lat = lattice(rng, gw, gh);
    for (let y = 0; y < h; y++) {
      const v = (y / (h - 1)) * cells;
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * cells;
        out[y * w + x] += sampleBilinear(lat, gw, gh, u, v) * amp;
      }
    }
    total += amp;
    amp *= 0.52;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ============ 世界生成 ============

export interface WorldGenOptions {
  size: WorldSizeKey;
  seed: number;
  /** 陆地占比目标 0.25 - 0.6 */
  landRatio: number;
  /** 随机程度：0 = 一大片大陆，1 = 破碎群岛 */
  fragmentation: number;
}

export const DEFAULT_GEN: WorldGenOptions = {
  size: 'medium',
  seed: 20261029,
  landRatio: 0.45,
  fragmentation: 0.35,
};

/**
 * 造一个空世界（地形 + 肥沃度已生成，没有生物）
 */
export function generateWorld(opt: WorldGenOptions): World {
  const { w, h } = WORLD_SIZES[opt.size];
  const rng = new Rng(opt.seed);

  const height = fbm(w, h, rng, 6);
  const moist = fbm(w, h, rng, 4);
  const detail = fbm(w, h, rng, 3);

  // 岛屿遮罩：把中心抬高，边缘压低，形成大陆；fragmentation 越高，遮罩越弱、噪声越强
  const frag = Math.max(0, Math.min(1, opt.fragmentation));
  const maskPow = 2.2 - frag * 1.4;
  const noiseWeight = 0.25 + frag * 0.55;

  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = Math.abs((y / (h - 1)) * 2 - 1); // 0 中心, 1 边缘
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x / (w - 1)) * 2 - 1);
      const d = Math.min(1, Math.sqrt(nx * nx * 0.85 + ny * ny * 1.15));
      const m = Math.pow(1 - d, maskPow);
      const i = y * w + x;
      raw[i] = height[i] * noiseWeight + m * (1 - noiseWeight) * 1.15 + (detail[i] - 0.5) * 0.1;
    }
  }

  // 按目标陆地占比求阈值（保证每次创世陆地面积稳定）
  const sorted = Float32Array.from(raw);
  sorted.sort();
  const cut = sorted[Math.floor(sorted.length * (1 - opt.landRatio))] ?? 0.5;

  const terrain = new Uint8Array(w * h);
  const fert = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    // 纬度：0 = 极地，1 = 赤道
    const lat01 = 1 - Math.abs((y / (h - 1)) * 2 - 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // 归一化到 0..1，cut 对应海岸线
      const above = raw[i] - cut; // 相对海平面的"高出度"
      const hn = Math.max(0, Math.min(1, above / Math.max(0.001, 1 - cut) * 1.5));
      const m = moist[i];
      const t = lat01; // 温度

      let ter: number;
      if (above <= 0) {
        // 水
        const depth = Math.min(1, -above / Math.max(0.001, cut));
        ter = depth > 0.28 ? T.Deep : T.Water;
      } else if (hn < 0.055) {
        ter = T.Sand;
      } else if (hn < 0.5) {
        if (m > 0.58 && hn < 0.26) ter = T.Swamp;
        else {
          // 森林边界用域扭曲打散：硬阈值会让林缘变成一条「刀切线」
          const warp = (vnoise(x * 0.22, y * 0.22, 91) - 0.5) * 0.16;
          const mw = m + warp;
          if (mw > 0.5) {
            ter = T.Forest;
            // 林间空地：森林内部偶尔露出一块草地，林子才有呼吸
            if (vnoise(x * 0.33, y * 0.33, 77) > 0.74) ter = T.Grass;
          } else if (mw > 0.43) {
            // 林缘：树疏一半，形成自然过渡带
            ter = vnoise(x * 0.55, y * 0.55, 33) > 0.48 ? T.Forest : T.Grass;
          } else {
            ter = T.Grass;
          }
        }
      } else if (hn < 0.7) {
        ter = T.Grass;
      } else if (hn < 0.85) {
        // 丘陵：单靠高度阈值会形成「等高线环」，看起来很假。
        // 用山脊噪声（1-|2n-1|）让它连成一条条山脊，才有山脉的走向。
        const ridge = 1 - Math.abs(vnoise(x * 0.055, y * 0.055, 55) * 2 - 1);
        ter = (ridge > 0.76 || hn > 0.81) ? T.Hill : T.Grass;
      } else if (hn < 0.95) {
        ter = T.Mountain;
      } else {
        ter = T.Snow;
      }

      // 寒带：极地附近草地变雪原，森林变雪林（保留森林以获得木材）
      if (t < 0.22 && (ter === T.Grass || ter === T.Forest || ter === T.Swamp)) {
        ter = t < 0.13 ? T.Snow : T.Forest;
      } else if (t < 0.3 && ter === T.Grass && rng.chance(0.5)) {
        ter = T.Snow;
      }
      // 山地雪线随纬度下降
      if (ter === T.Mountain && t < 0.45) ter = T.Snow;

      terrain[i] = ter;

      // 肥沃度
      let f: number;
      switch (ter) {
        case T.Grass: f = 150 + m * 70; break;
        case T.Forest: f = 110 + m * 60; break;
        case T.Swamp: f = 55 + m * 45; break;
        case T.Sand: f = 18 + m * 35; break;
        case T.Hill: f = 70 + m * 55; break;
        case T.Mountain: f = 22 + m * 30; break;
        case T.Snow: f = 8 + m * 25; break;
        case T.Ruin: f = 90 + m * 40; break;
        default: f = 0;
      }
      f *= 0.78 + rng.next() * 0.44;
      fert[i] = Math.max(0, Math.min(255, Math.round(f)));
    }
  }

  // 稀疏化陆地判定：清理孤立单格水洼/陆地，让海岸线更"像素友好"
  cleanupIslands(terrain, w, h);

  // 开凿河流：从丘陵/山地一路流到海里
  carveRivers(terrain, fert, w, h, rng, Math.max(16, Math.round((w * h) / 900)));
  // 点缀湖泊：低洼处积水，让水系看起来完整
  carveLakes(terrain, fert, w, h, rng, Math.max(10, Math.round((w * h) / 1600)));

  const world: World = {
    w,
    h,
    terrain,
    fert,
    owner: new Int32Array(w * h).fill(-1),
    nationOf: new Int16Array(w * h).fill(-1),
    fire: new Uint8Array(w * h),
    plague: new Uint8Array(w * h),
    seed: opt.seed,
    rngState: rng.s,
    year: 0,
    tick: 0,
    settlements: [],
    nations: [],
    agents: [],
    beasts: [],
    wonders: [],
    units: [],
    battles: [],
    events: [],
    stats: {
      warsDeclared: 0,
      battles: 0,
      citiesFounded: 0,
      citiesDestroyed: 0,
      disasters: 0,
      gifts: 0,
      peakPop: 0,
      racePeak: [0, 0, 0, 0],
      popHistory: [],
    },
    ended: false,
    endReason: '',
    extincted: [false, false, false, false],
    hasFire: false,
    hasPlague: false,
    overtime: false,
  };
  return world;
}

/** 点缀湖泊：在陆地上挖出不规则的小水面，湖岸带一圈浅沙 */
function carveLakes(
  terrain: Uint8Array, fert: Uint8Array,
  w: number, h: number, rng: Rng, count: number,
): void {
  for (let k = 0; k < count; k++) {
    const cx = rng.int(w);
    const cy = rng.int(h);
    const i0 = cy * w + cx;
    const t0 = terrain[i0];
    if (t0 === T.Water || t0 === T.Deep || t0 === T.Snow || t0 === T.Mountain) continue;

    const rx = 3 + rng.int(5);
    const ry = 2 + rng.int(4);

    for (let dy = -Math.ceil(ry) - 1; dy <= Math.ceil(ry) + 1; dy++) {
      const y = cy + dy;
      if (y < 1 || y >= h - 1) continue;
      for (let dx = -Math.ceil(rx) - 1; dx <= Math.ceil(rx) + 1; dx++) {
        const x = cx + dx;
        if (x < 1 || x >= w - 1) continue;
        const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
        const i = y * w + x;
        if (d <= 1) {
          if (terrain[i] === T.Deep) continue;
          terrain[i] = T.Water;
          fert[i] = 145;
        } else if (d <= 1.9 && rng.chance(0.5)) {
          // 湖岸浅滩
          const t = terrain[i];
          if (t === T.Grass || t === T.Forest || t === T.Swamp) {
            terrain[i] = T.Sand;
            fert[i] = 110;
          }
        }
      }
    }
  }
}

/** 地形"高度"排序，用来决定水往哪里流 */
const WATER_RANK = [0, 0.5, 1, 2, 2.2, 3, 4, 4.5, 1.5, 2];

/**
 * 开凿河流：从丘陵/山地取源点，沿最陡下降方向一路挖到海里。
 * 遇到局部最低点就积成小湖，然后停住。
 */
function carveRivers(
  terrain: Uint8Array, fert: Uint8Array,
  w: number, h: number, rng: Rng, count: number,
): void {
  const dirs: [number, number][] = [
    [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  for (let r = 0; r < count; r++) {
    // 找源头：优先丘陵/山地，找不到就退而取森林里的"高处"
    let sx = -1;
    let sy = -1;
    for (let t = 0; t < 900; t++) {
      const x = rng.int(w);
      const y = rng.int(h);
      const ter = terrain[y * w + x];
      if (ter === T.Hill || ter === T.Mountain) { sx = x; sy = y; break; }
      if (sx < 0 && ter === T.Forest && rng.chance(0.25)) { sx = x; sy = y; }
    }
    if (sx < 0) continue;

    let x = sx;
    let y = sy;
    let steps = 0;
    while (steps++ < 400) {
      const i = y * w + x;
      const ter = terrain[i];
      if (ter === T.Water || ter === T.Deep) break;

      terrain[i] = T.Water;
      fert[i] = 130;

      // 河宽 2-3 格：太细的河在俯瞰下就是一条看不见的线
      if (rng.chance(0.92)) {
        const side: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const [dx, dy] = side[rng.int(4)];
        const nx = x + dx;
        const ny = y + dy;
        if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1) {
          const j = ny * w + nx;
          if (terrain[j] !== T.Deep) {
            terrain[j] = T.Water;
            fert[j] = 150;
          }
        }
      }

      // 每走 3 步把河岸啃掉一点，做出宽窄变化
      if (steps % 3 === 0) {
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const j = ny * w + nx;
          const nt = terrain[j];
          if (nt === T.Water || nt === T.Deep || nt === T.Snow) continue;
          if (rng.chance(0.4)) {
            terrain[j] = T.Water;
            fert[j] = 150;
          }
        }
      }

      // 下一步：走向最低的邻居
      let bx = -1;
      let by = -1;
      let bestR = 99;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const rr = WATER_RANK[terrain[ny * w + nx]] ?? 2;
        if (rr < bestR - 0.001) { bestR = rr; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      x = bx;
      y = by;
    }
  }
}

/** 去掉只有 1-2 格的孤立陆地/水塘，让地图更像"大陆"而不是噪点 */
function cleanupIslands(terrain: Uint8Array, w: number, h: number): void {
  const isLand = (i: number) => terrain[i] !== T.Deep && terrain[i] !== T.Water;
  const copy = Uint8Array.from(terrain);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const self = isLand(i);
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = (y + dy) * w + (x + dx);
          if (isLand(j) === self) same++;
        }
      }
      if (same === 0) {
        // 孤立即转为海（陆）或浅海（水）
        copy[i] = self ? T.Water : T.Deep;
      }
    }
  }
  terrain.set(copy);
}

/** 找一片适合建城的空地（在给定区域内） */
export function findLandNear(
  world: World, cx: number, cy: number, radius: number, accept: (i: number) => boolean,
): number {
  const { w, h, terrain } = world;
  let best = -1;
  let bestScore = -1;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= w - 1) continue;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * w + x;
      if (world.owner[i] !== -1) continue;
      if (!accept(i)) continue;
      const score = world.fert[i] - (dx * dx + dy * dy) * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}
