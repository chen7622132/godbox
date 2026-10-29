import { Rng } from './rng';
import { T, WORLD_SIZES, type World, type WorldSizeKey } from './types';

// ============ 噪声 ============

function lattice(rng: Rng, gw: number, gh: number): Float32Array {
  const a = new Float32Array(gw * gh);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
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
        if (m > 0.66 && hn < 0.2) ter = T.Swamp;
        else if (m > 0.46) ter = T.Forest;
        else ter = T.Grass;
      } else if (hn < 0.7) {
        ter = T.Grass;
      } else if (hn < 0.85) {
        ter = T.Hill;
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
