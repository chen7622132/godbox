import { T, IS_LAND, type World } from '../core/types';
import { RACES } from '../core/races';
import { genTree, genRock, genBush, genPuddle, blit, packPx, type Sprite } from './sprites';

/** 地形基础色 [r,g,b] */
const PALETTE: [number, number, number][] = [
  [15, 38, 70],    // 0 Deep
  [34, 92, 144],   // 1 Water
  [220, 200, 146], // 2 Sand
  [98, 156, 74],   // 3 Grass
  [44, 96, 56],    // 4 Forest
  [146, 150, 98],  // 5 Hill
  [132, 126, 116], // 6 Mountain
  [212, 224, 234], // 7 Snow
  [72, 86, 62],    // 8 Swamp
  [106, 98, 88],   // 9 Ruin
];

const FIRE: [number, number, number] = [252, 140, 44];
const FIRE_HOT: [number, number, number] = [255, 240, 170];
const PLAGUE: [number, number, number] = [146, 62, 154];

/** 缩放档位：必须是细节像素数的整数倍 */
const ZOOM_STEPS = [1, 2, 3, 4, 8, 12, 16, 20, 24, 32];
const ZOOM_MAX = 32;

function h2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 平滑值噪声：用来做地面的大块明暗起伏，避免整片平涂 */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = h2(xi + seed * 7919, yi + seed * 104729);
  const b = h2(xi + 1 + seed * 7919, yi + seed * 104729);
  const c = h2(xi + seed * 7919, yi + 1 + seed * 104729);
  const d = h2(xi + 1 + seed * 7919, yi + 1 + seed * 104729);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 每种地形的装饰精灵缓存：[地形][变体] */
type DecoSet = Sprite[];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  private dpr = 1;
  private tile = 1;
  private painted: Region = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private camDirty = true;
  private spriteCache = new Map<string, DecoSet>();
  cssW = 1;
  cssH = 1;

  cam: Camera = { x: 0, y: 0, zoom: 4 };
  hover: { x: number; y: number } | null = null;
  hoverRadius = 2;
  selected: number | null = null;

  private tintCache = new Map<number, [number, number, number]>();
  dirty = true;

  markDirty(): void {
    this.dirty = true;
  }

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 不可用');
    this.ctx = ctx;

    this.off = document.createElement('canvas');
    const offCtx = this.off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) throw new Error('离屏 Canvas 不可用');
    this.offCtx = offCtx;

    this.resize();
    this.fit(world);
    this.allocate(world);
    window.addEventListener('resize', () => this.resize());
  }

  private allocate(world: World): void {
    const t = pickTile(this.cam.zoom);
    const W = world.w * t;
    const H = world.h * t;
    this.tile = t;
    this.off.width = W;
    this.off.height = H;
    this.img = this.offCtx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.spriteCache.clear();
    this.dirty = true;
    this.camDirty = true;
  }

  attachWorld(world: World): void {
    this.tintCache.clear();
    this.fit(world);
    this.allocate(world);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(320, Math.floor(r.width));
    this.cssH = Math.max(240, Math.floor(r.height));
    this.canvas.width = Math.floor(this.cssW * this.dpr);
    this.canvas.height = Math.floor(this.cssH * this.dpr);
    this.camDirty = true;
  }

  fit(world: World): void {
    const raw = Math.min(this.cssW / world.w, this.cssH / world.h) * 0.99;
    let z = 1;
    for (const s of ZOOM_STEPS) if (s <= raw) z = s;
    this.cam.zoom = z;
    this.cam.x = world.w / 2;
    this.cam.y = world.h / 2;
  }

  private viewOrigin(): [number, number] {
    const z = this.cam.zoom;
    return [
      Math.floor(this.cam.x - this.cssW / 2 / z),
      Math.floor(this.cam.y - this.cssH / 2 / z),
    ];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    const [vx, vy] = this.viewOrigin();
    return [(wx - vx) * this.cam.zoom, (wy - vy) * this.cam.zoom];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const [vx, vy] = this.viewOrigin();
    return [vx + sx / this.cam.zoom, vy + sy / this.cam.zoom];
  }

  pan(dx: number, dy: number): void {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.camDirty = true;
  }

  clampCam(world: World): void {
    const hw = this.cssW / 2 / this.cam.zoom;
    const hh = this.cssH / 2 / this.cam.zoom;
    const nx = world.w * this.cam.zoom <= this.cssW
      ? world.w / 2
      : Math.max(hw * 0.4, Math.min(world.w - hw * 0.4, this.cam.x));
    const ny = world.h * this.cam.zoom <= this.cssH
      ? world.h / 2
      : Math.max(hh * 0.4, Math.min(world.h - hh * 0.4, this.cam.y));
    if (nx !== this.cam.x || ny !== this.cam.y) {
      this.cam.x = nx;
      this.cam.y = ny;
      this.camDirty = true;
    }
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const dir = factor > 1 ? 1 : -1;
    const cur = this.cam.zoom;
    let i = ZOOM_STEPS.indexOf(cur);
    if (i < 0) {
      i = 0;
      let bestD = Infinity;
      for (let k = 0; k < ZOOM_STEPS.length; k++) {
        const d = Math.abs(ZOOM_STEPS[k] - cur);
        if (d < bestD) { bestD = d; i = k; }
      }
    }
    const ni = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir));
    if (ni === i) return;
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.cam.zoom = ZOOM_STEPS[ni];
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.cam.x += wx - wx2;
    this.cam.y += wy - wy2;
    this.camDirty = true;
  }

  // ==================== 渲染 ====================

  render(world: World): void {
    const wantTile = pickTile(this.cam.zoom);
    if (wantTile !== this.tile || this.off.width !== world.w * wantTile) {
      this.allocate(world);
    }

    const [vx, vy] = this.viewOrigin();
    const vw = Math.ceil(this.cssW / this.cam.zoom) + 3;
    const vh = Math.ceil(this.cssH / this.cam.zoom) + 3;
    const region: Region = {
      x0: Math.max(0, vx - 2),
      y0: Math.max(0, vy - 2),
      x1: Math.min(world.w, vx + vw + 1),
      y1: Math.min(world.h, vy + vh + 1),
    };

    if (this.dirty || this.camDirty || !sameRegion(region, this.painted)) {
      this.paintRegion(world, region);
      this.offCtx.putImageData(
        this.img, 0, 0,
        region.x0 * this.tile, region.y0 * this.tile,
        (region.x1 - region.x0) * this.tile, (region.y1 - region.y0) * this.tile,
      );
      this.painted = region;
      this.dirty = false;
      this.camDirty = false;
    }

    const { ctx, cssW, cssH } = this;
    const z = this.cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#070a0f';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.drawImage(this.off, -vx * z, -vy * z, world.w * z, world.h * z);

    this.drawRoads(world);
    this.drawSettlements(world);
    this.drawHover();
  }

  // ==================== 地形 ====================

  private paintRegion(world: World, r: Region): void {
    const { w, h, terrain, fert, owner, nationOf, fire, plague } = world;
    const buf = this.buf;
    const T2 = this.tile;
    const W = world.w * T2;
    const H = world.h * T2;
    const tint = this.buildTint(world);

    // ---- 第一遍：地面底色（连续噪声，不是图案）----
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * w + x;
        const t = terrain[i];
        const pal = PALETTE[t] ?? PALETTE[0];
        const f = fert[i];

        // 三层噪声：大斑块 / 中起伏 / 每像素颗粒
        const low = vnoise(x * 0.09, y * 0.09, 3);
        const mid = vnoise(x * 0.4, y * 0.4, 11);
        let base = 0.74 + low * 0.36 + mid * 0.14;

        if (IS_LAND[t] && t !== T.Snow) {
          base *= 0.86 + (f / 255) * 0.3;
        }

        let br = pal[0] * base;
        let bg = pal[1] * base;
        let bb = pal[2] * base;

        // 领土色
        const oid = owner[i];
        if (oid >= 0) {
          const tc = tint.get(oid);
          if (tc) {
            br = br * 0.5 + tc[0] * 0.5;
            bg = bg * 0.5 + tc[1] * 0.5;
            bb = bb * 0.5 + tc[2] * 0.5;
          }
        }

        // 国界：压暗
        if (oid >= 0) {
          const nid = nationOf[i];
          const rn = x + 1 < w ? nationOf[i + 1] : -1;
          const dn = y + 1 < h ? nationOf[i + w] : -1;
          const ro = x + 1 < w ? owner[i + 1] : -1;
          const dow = y + 1 < h ? owner[i + w] : -1;
          if (nid !== rn || nid !== dn) {
            br *= 0.3; bg *= 0.3; bb *= 0.3;
          } else if (ro !== oid || dow !== oid) {
            br *= 0.76; bg *= 0.76; bb *= 0.76;
          }
        }

        // 近岸浅水
        if (!IS_LAND[t]) {
          let near = 0;
          if (y > 0 && IS_LAND[terrain[i - w]]) near++;
          if (y + 1 < h && IS_LAND[terrain[i + w]]) near++;
          if (x > 0 && IS_LAND[terrain[i - 1]]) near++;
          if (x + 1 < w && IS_LAND[terrain[i + 1]]) near++;
          if (near > 0) {
            const k = Math.min(0.4, near * 0.12);
            br = br * (1 - k) + 116 * k;
            bg = bg * (1 - k) + 172 * k;
            bb = bb * (1 - k) + 184 * k;
          }
        }

        const fv = fire[i];
        const pv = plague[i];
        const fk = fv > 0 ? Math.min(1, fv / 150) : 0;
        const pk = pv > 0 ? Math.min(0.75, pv / 220) : 0;

        const above = y > 0 ? terrain[i - w] : t;
        const surf = !IS_LAND[t] && IS_LAND[above] ? 1.3 : 1;
        const below = y + 1 < h ? terrain[i + w] : T.Deep;
        const cliff = IS_LAND[t] && !IS_LAND[below] ? 0.85 : 1;

        const ox = x * T2;
        const oy = y * T2;
        for (let py = 0; py < T2; py++) {
          const rowBase = (oy + py) * W + ox;
          // 水面横向波纹
          const ripple = !IS_LAND[t] ? Math.sin((y * T2 + py) * 0.9 + x * 0.6) * 0.05 : 0;
          for (let px = 0; px < T2; px++) {
            const grain = (h2(x * 31 + px, y * 37 + py) - 0.5) * 0.09;
            let s = 1 + grain + ripple;
            if (py === T2 - 1) s *= 0.93;
            s *= cliff;
            if (surf > 1 && py === 0) s *= surf;

            let cr = br * s;
            let cg = bg * s;
            let cb = bb * s;
            if (fk > 0) {
              cr = cr * (1 - fk) + (FIRE_HOT[0] * 0.45 + FIRE[0] * 0.55) * fk;
              cg = cg * (1 - fk) + (FIRE_HOT[1] * 0.45 + FIRE[1] * 0.55) * fk;
              cb = cb * (1 - fk) + (FIRE_HOT[2] * 0.35 + FIRE[2] * 0.35) * fk;
            }
            if (pk > 0) {
              cr = cr * (1 - pk) + PLAGUE[0] * pk;
              cg = cg * (1 - pk) + PLAGUE[1] * pk;
              cb = cb * (1 - pk) + PLAGUE[2] * pk;
            }
            buf[rowBase + px] = packPx(cr, cg, cb);
          }
        }
      }
    }

    if (T2 < 4) return; // 远景不画装饰，省性能

    // ---- 第二遍：跨格装饰（树 / 岩 / 草 / 水洼）----
    const deco = this.decoSets(T2);
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * w + x;
        const t = terrain[i];
        const rnd = h2(x * 2654435761, y * 40503);
        const variant = Math.floor(h2(x * 7919, y * 104729) * 3) % 3;
        const cx = x * T2;
        const cy = y * T2;

        if (t === T.Forest) {
          // 密度随大尺度噪声变化：有的地方是密林，有的是林间空地
          const dens = vnoise(x * 0.13, y * 0.13, 23);
          if (rnd < 0.4 + dens * 0.55) {
            const sp = deco.forest[variant];
            blit(buf, W, H, sp, cx + ((T2 - sp.w) >> 1), cy + T2 - sp.h + Math.round(T2 * 0.2));
          }
        } else if (t === T.Grass) {
          const dens = vnoise(x * 0.11, y * 0.11, 29);
          if (rnd < dens * 0.18) {
            const sp = deco.tree[variant];
            blit(buf, W, H, sp, cx + ((T2 - sp.w) >> 1), cy + T2 - sp.h + Math.round(T2 * 0.2));
          } else if (rnd < 0.22 + dens * 0.2) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Hill) {
          if (rnd < 0.16) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          } else if (rnd < 0.26) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Mountain) {
          if (rnd < 0.4) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Snow) {
          if (rnd < 0.12) {
            const sp = deco.snowRock[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Swamp) {
          if (rnd < 0.28) {
            const sp = deco.puddle[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          } else if (rnd < 0.5) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Sand) {
          if (rnd < 0.05) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        } else if (t === T.Ruin) {
          if (rnd < 0.35) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx, cy + T2 - sp.h);
          }
        }
      }
    }
  }

  /** 按当前细节密度生成/缓存装饰精灵 */
  private decoSets(tile: number): Record<string, DecoSet> {
    const key = `t${tile}`;
    const cached = this.spriteCache.get(key);
    if (cached) return cached as unknown as Record<string, DecoSet>;

    const treeSize = tile === 8 ? 26 : tile === 4 ? 13 : 6;
    const rockSize = tile === 8 ? 16 : tile === 4 ? 8 : 4;
    const bushSize = tile === 8 ? 14 : tile === 4 ? 7 : 4;
    const puddleSize = tile === 8 ? 16 : tile === 4 ? 8 : 4;

    const sets: Record<string, DecoSet> = {
      // 森林里的树：深绿，压暗一些（林下光线弱）
      forest: [
        genTree(treeSize, [34, 82, 42], [60, 44, 28], 101, 0),
        genTree(treeSize, [40, 94, 48], [64, 46, 30], 202, 1),
        genTree(treeSize, [30, 74, 40], [56, 40, 26], 303, 2),
      ],
      // 草原孤树：亮绿
      tree: [
        genTree(treeSize, [72, 132, 58], [72, 54, 34], 404, 0),
        genTree(treeSize, [86, 144, 66], [76, 58, 38], 505, 1),
        genTree(treeSize, [64, 120, 52], [68, 50, 32], 606, 2),
      ],
      rock: [
        genRock(rockSize, [136, 132, 122], 707),
        genRock(rockSize, [120, 116, 108], 808),
        genRock(rockSize, [148, 142, 130], 909),
      ],
      snowRock: [
        genRock(rockSize, [222, 232, 240], 111),
        genRock(rockSize, [206, 218, 228], 222),
        genRock(rockSize, [234, 242, 248], 333),
      ],
      bush: [
        genBush(bushSize, [86, 142, 62], 444),
        genBush(bushSize, [74, 128, 56], 555),
        genBush(bushSize, [96, 152, 70], 666),
      ],
      puddle: [
        genPuddle(puddleSize, [52, 84, 88], 777),
        genPuddle(puddleSize, [46, 76, 80], 888),
        genPuddle(puddleSize, [58, 92, 96], 999),
      ],
    };
    this.spriteCache.set(key, sets as unknown as DecoSet);
    return sets;
  }

  // ==================== 道路 ====================

  private drawRoads(world: World): void {
    const z = this.cam.zoom;
    if (z < 4) return;
    const { ctx } = this;
    const segs: [[number, number], [number, number]][] = [];

    for (const n of world.nations) {
      if (!n.alive) continue;
      const cities = n.cities
        .map((id) => world.settlements[id])
        .filter((s) => s && s.alive && !s.ruin);
      if (cities.length < 2) continue;

      for (let i = 0; i < cities.length; i++) {
        const a = cities[i];
        let best: typeof a | null = null;
        let bestD = Infinity;
        for (let j = 0; j < cities.length; j++) {
          if (i === j) continue;
          const b = cities[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (!best || bestD > 55) continue;
        if (best.id < a.id) continue;
        const [ax, ay] = this.worldToScreen(a.x + 0.5, a.y + 0.5);
        const [bx, by] = this.worldToScreen(best.x + 0.5, best.y + 0.5);
        if (Math.max(ax, bx) < -50 || Math.min(ax, bx) > this.cssW + 50) continue;
        if (Math.max(ay, by) < -50 || Math.min(ay, by) > this.cssH + 50) continue;
        segs.push([[ax, ay], [bx, by]]);
      }
    }

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(56,44,26,0.5)';
    ctx.lineWidth = Math.max(3, z * 0.36);
    for (const [[ax, ay], [bx, by]] of segs) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(214,192,144,0.88)';
    ctx.lineWidth = Math.max(1.4, z * 0.17);
    for (const [[ax, ay], [bx, by]] of segs) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // ==================== 建筑 + 人口 ====================

  private drawSettlements(world: World): void {
    const { ctx } = this;
    const z = this.cam.zoom;

    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      const [sx, sy] = this.worldToScreen(s.x + 0.5, s.y + 0.5);
      if (sx < -90 || sy < -90 || sx > this.cssW + 90 || sy > this.cssH + 90) continue;

      const race = RACES[s.race];
      const unit = z;

      if (z < 3) {
        const size = Math.max(2, Math.round(unit * 0.6));
        ctx.fillStyle = race.color;
        ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
        if (s.capital) {
          ctx.fillStyle = '#fff3c4';
          ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, Math.max(1, size / 3));
        }
        continue;
      }

      // 城市地面的清空区（土黄色夯土，让建筑不像浮在草上）
      ctx.fillStyle = 'rgba(168,148,110,0.55)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, unit * 1.5, unit * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();

      // 城墙
      if (s.walls > 0) {
        const half = unit * 1.75;
        const thick = Math.max(2, unit * 0.2);
        ctx.fillStyle = '#726a55';
        ctx.fillRect(sx - half, sy - half, half * 2, thick);
        ctx.fillRect(sx - half, sy + half - thick, half * 2, thick);
        ctx.fillRect(sx - half, sy - half, thick, half * 2);
        ctx.fillRect(sx + half - thick, sy - half, thick, half * 2);
        ctx.fillStyle = '#8b826a';
        for (let k = 0; k < 5; k++) {
          const tx = sx - half + (half * 2 * (k + 0.5)) / 5 - thick * 0.3;
          ctx.fillRect(tx, sy - half - thick * 0.4, thick * 0.6, thick * 0.5);
          ctx.fillRect(tx, sy + half - thick * 0.1, thick * 0.6, thick * 0.5);
        }
        const gate = Math.max(3, unit * 0.4);
        ctx.fillStyle = '#443b2b';
        ctx.fillRect(sx - gate / 2, sy + half - thick - 1, gate, thick + 2);
        if (s.walls >= 2) {
          const tw = Math.max(3, unit * 0.32);
          ctx.fillStyle = '#5e5643';
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.fillRect(sx + dx * half - tw / 2, sy + dy * half - tw / 2, tw, tw);
          }
        }
      }

      // 房屋
      const houseCount = [2, 4, 6, 8, 11][s.tier] ?? 2;
      const spread = unit * (s.walls > 0 ? 1.2 : 1.35);
      const roof = shade(race.rgb, 0.95);
      const roofDark = shade(race.rgb, 0.62);
      const seed = s.id * 7919 + 13;
      const innerCount = Math.min(3, houseCount);

      for (let k = 0; k < houseCount; k++) {
        const ring = k < innerCount ? 0 : 1;
        const idx = ring === 0 ? k : k - innerCount;
        const per = ring === 0 ? innerCount : Math.max(1, houseCount - innerCount);
        const a = (idx / per) * Math.PI * 2 + (ring === 0 ? Math.PI / 4 : 0) + h2(seed, k) * 0.3;
        const rr = spread * (ring === 0 ? 0.4 : 1) * (0.92 + h2(seed + 41, k) * 0.16);
        const bx = sx + Math.cos(a) * rr;
        const by = sy + Math.sin(a) * rr * 0.7;
        this.drawHouse(bx, by, unit * 0.72, unit * 0.7, roof, roofDark, k % 3 === 0, k % 2 === 0);
      }

      // 都城王宫
      if (s.capital && s.tier >= 2) {
        this.drawHouse(sx, sy - unit * 0.15, unit * 1.05, unit * 1.0, roof, roofDark, true, true);
        ctx.fillStyle = '#8a7a55';
        ctx.fillRect(Math.round(sx), Math.round(sy - unit * 1.5), Math.max(1, unit * 0.1), Math.round(unit * 0.9));
        ctx.fillStyle = race.color;
        ctx.fillRect(
          Math.round(sx + unit * 0.1),
          Math.round(sy - unit * 1.5),
          Math.max(2, unit * 0.24),
          Math.max(1, unit * 0.15),
        );
      }

      // 小人
      if (z >= 6) {
        const people = Math.min(8, Math.max(3, Math.floor(s.pop / 70)));
        const pseed = s.id * 131 + 7;
        const headW = Math.max(3, Math.round(z * 0.3));
        const bodyW = Math.max(3, Math.round(z * 0.32));
        const bodyH = Math.max(5, Math.round(z * 0.56));
        const skin = '#f2cfa8';

        for (let k = 0; k < people; k++) {
          const a = (k / people) * Math.PI * 2 + h2(pseed, k) * 0.5;
          const rr = unit * (1.55 + h2(pseed + 17, k) * 0.3);
          const px = Math.round(sx + Math.cos(a) * rr);
          const py = Math.round(sy + Math.sin(a) * rr * 0.7);
          const topY = py - headW;
          const legH = Math.max(2, Math.round(z * 0.16));
          const totalH = headW + bodyH + legH;

          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.fillRect(px - 1, py + bodyH, bodyW + 2, Math.max(1, Math.round(z * 0.09)));
          ctx.fillStyle = 'rgba(8,6,3,0.42)';
          ctx.fillRect(px - 1, topY - 1, bodyW + 2, totalH + 2);
          ctx.fillStyle = skin;
          ctx.fillRect(px, topY, headW, headW);
          ctx.fillStyle = shade(race.rgb, 0.85);
          ctx.fillRect(px, topY, headW, Math.max(1, Math.round(headW * 0.45)));
          ctx.fillStyle = k % 3 === 0 ? race.color : shade(race.rgb, 0.85);
          ctx.fillRect(px, topY + headW, bodyW, bodyH);
          ctx.fillStyle = 'rgba(20,15,8,0.5)';
          ctx.fillRect(px, topY + headW + Math.floor(bodyH * 0.6), bodyW, 1);
          ctx.fillStyle = shade(race.rgb, 0.5);
          ctx.fillRect(px, topY + headW + bodyH, Math.max(1, Math.round(bodyW * 0.38)), legH);
          ctx.fillRect(
            px + Math.max(1, Math.round(bodyW * 0.58)),
            topY + headW + bodyH,
            Math.max(1, Math.round(bodyW * 0.38)),
            legH,
          );
        }
      }

      // 人口数字
      if (z >= 16) {
        const label = String(Math.round(s.pop));
        ctx.font = `bold ${Math.max(8, Math.round(z * 0.5))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const ty = sy - unit * 1.5;
        ctx.lineWidth = Math.max(2, z * 0.16);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(4,7,11,0.88)';
        ctx.strokeText(label, sx, ty);
        ctx.fillStyle = '#ffeeb0';
        ctx.fillText(label, sx, ty);
      }

      if (this.selected === s.id) {
        ctx.strokeStyle = '#ffd447';
        ctx.lineWidth = 2;
        const pad = unit * 1.6;
        ctx.strokeRect(Math.round(sx - pad), Math.round(sy - pad), Math.round(pad * 2), Math.round(pad * 2));
      }
    }
  }

  /** 一栋房子：三角屋顶（明暗两面）+ 墙（明暗两面）+ 门窗 */
  private drawHouse(
    bx: number, by: number, hw: number, hh: number,
    roof: string, roofDark: string, lightWall: boolean, lightRoof: boolean,
  ): void {
    const { ctx } = this;
    const bw = Math.max(5, Math.round(hw));
    const bh = Math.max(5, Math.round(hh));
    const x0 = Math.round(bx - bw / 2);
    const y0 = Math.round(by - bh / 2);
    const eave = y0 + Math.round(bh * 0.46);
    const wallH = y0 + bh - eave;
    const ridge = y0 + Math.round(bh * 0.06);

    // 落地影
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x0 + 2, y0 + bh - 1, bw, Math.max(2, Math.round(bh * 0.14)));

    // 墙
    ctx.fillStyle = lightWall ? '#f4ecd6' : '#ddd1b2';
    ctx.fillRect(x0, eave, bw, wallH);
    // 右墙背光
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x0 + Math.round(bw * 0.6), eave, Math.round(bw * 0.4), wallH);
    // 窗
    if (bw >= 8) {
      ctx.fillStyle = 'rgba(48,38,24,0.7)';
      ctx.fillRect(x0 + Math.round(bw * 0.1), eave + Math.round(wallH * 0.15), Math.max(1, Math.round(bw * 0.15)), Math.max(1, Math.round(wallH * 0.3)));
    }
    // 门
    if (bw >= 6) {
      ctx.fillStyle = 'rgba(42,32,20,0.85)';
      ctx.fillRect(
        x0 + Math.round(bw * 0.42),
        eave + Math.round(wallH * 0.38),
        Math.max(1, Math.round(bw * 0.18)),
        Math.max(2, wallH - Math.round(wallH * 0.38)),
      );
    }

    // 屋顶：三角，左亮右暗
    ctx.fillStyle = lightRoof ? roof : roofDark;
    ctx.beginPath();
    ctx.moveTo(x0 + bw * 0.5, ridge);
    ctx.lineTo(x0 + bw, eave);
    ctx.lineTo(x0, eave);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.moveTo(x0 + bw * 0.5, ridge);
    ctx.lineTo(x0 + bw, eave);
    ctx.lineTo(x0 + bw * 0.5, eave);
    ctx.closePath();
    ctx.fill();
    // 屋脊高光 + 屋檐
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x0 + Math.round(bw * 0.42), ridge, Math.max(1, Math.round(bw * 0.16)), 1);
    ctx.fillStyle = 'rgba(16,12,6,0.5)';
    ctx.fillRect(x0, eave, bw, 1);
  }

  private drawHover(): void {
    if (!this.hover) return;
    const { ctx } = this;
    const z = this.cam.zoom;
    const r = Math.max(1, this.hoverRadius);
    const [sx, sy] = this.worldToScreen(this.hover.x - r + 0.5, this.hover.y - r + 0.5);
    const d = (r * 2) * z;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(d), Math.round(d));
    ctx.setLineDash([]);
  }

  private buildTint(world: World): Map<number, [number, number, number]> {
    const map = this.tintCache;
    map.clear();
    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      const rgb = RACES[s.race].rgb;
      const k = s.nation >= 0 ? 0.9 : 0.6;
      map.set(s.id, [rgb[0] * k, rgb[1] * k, rgb[2] * k]);
    }
    return map;
  }
}

function pickTile(zoom: number): number {
  if (zoom >= 8 && zoom % 8 === 0) return 8;
  if (zoom >= 4 && zoom % 4 === 0) return 4;
  return 1;
}

function sameRegion(a: Region, b: Region): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

function shade(rgb: [number, number, number], k: number): string {
  const r = Math.min(255, Math.round(rgb[0] * k));
  const g = Math.min(255, Math.round(rgb[1] * k));
  const b = Math.min(255, Math.round(rgb[2] * k));
  return `rgb(${r},${g},${b})`;
}
