import { T, IS_LAND, type World } from '../core/types';
import { RACES } from '../core/races';
import { genTree, genRock, genBush, genPuddle, blit, packPx, type Sprite } from './sprites';

/** 四族外观：体型、肤色、衣着、发色 —— WorldBox 就是靠这几项区分种族的 */

/**
 * 地形基础色 [r,g,b] —— 取自 WorldBox 官方地形表「方块颜色」
 * 深海 #2D61AF / 浅滩 #55AEF0 / 沙 #F7E898 / 草 #76B153 / 林 #46A052
 * 丘陵 #5B5E5C / 山 #414545 / 雪 #D3E4E3 / 沼泽 #746655
 */
const PALETTE: [number, number, number][] = [
  [40, 104, 190],  // 0 Deep   更深更饱和，海才有「深度」
  [94, 186, 248],  // 1 Water
  [252, 240, 170], // 2 Sand
  [124, 192, 86],  // 3 Grass  提亮 + 提饱和，这是整张图的基调
  [60, 148, 74],   // 4 Forest 压深，和草地拉开层次
  [108, 110, 98],  // 5 Hill   偏暖灰，不是死灰
  [78, 82, 84],    // 6 Mountain
  [222, 238, 238], // 7 Snow
  [122, 108, 88],  // 8 Swamp
  [182, 174, 158], // 9 Ruin
];

/**
 * 地形「边缘色」—— WorldBox 每个方块 = 底色 + 1px 略亮内边，
 * 这是整个画面「有厚度」的唯一来源。这里存亮边系数用途的绝对色。
 */
const EDGE: [number, number, number][] = [
  [61, 118, 199],  // 0 深海亮边
  [63, 144, 234],  // 1 浅滩边 #3F90EA
  [255, 247, 200], // 2 沙边（#D8C08C 提亮）
  [140, 220, 106], // 3 草边 #8CDC6A
  [138, 207, 85],  // 4 林边 #8ACF55
  [122, 126, 124], // 5 丘陵边
  [91, 94, 92],    // 6 山边
  [252, 253, 253], // 7 雪边 #FCFDFD
  [140, 142, 101], // 8 沼泽边 #8C8E65
  [205, 198, 182], // 9 废墟边
];

const FIRE: [number, number, number] = [252, 140, 44];
const FIRE_HOT: [number, number, number] = [255, 240, 170];
const PLAGUE: [number, number, number] = [146, 62, 154];

/** 缩放档位：必须是细节像素数的整数倍 */
const ZOOM_STEPS = [1, 2, 3, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const ZOOM_MAX = 32;

import { RACE_LOOK, paintUnit } from './unitsprite';

// 图鉴脚本仍从 renderer 取这两个符号，保持对外接口不变
export { paintUnit, RACE_LOOK as RACE_LOOK_EXPORT };

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
  /** 每帧复用的绘制排序表，避免反复分配数组 */
  private _unitList: World['units'] = [];
  /**
   * 建筑绘制队列。
   *
   * 为什么要延迟：一栋房子和一个人的前后关系，取决于谁离镜头更近（世界 y 更大）。
   * 原来的画法是「先把整座城画完，再把所有人画上去」——于是人永远浮在屋顶上，
   * 这就是用户说的「穿模 / 机械叠加」。现在建筑和单位进同一个队列，按脚底 y 排序后
   * 交替绘制，人走到房子后面就会被挡住，走到前面就会盖住墙。
   */
  private _pending: { wy: number; draw: () => void }[] = [];
  /** 上一次构建绘制队列时的「视角指纹」，一致就整套复用，不必每帧重建 */
  private _pendingSig = '';
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
    this.drawWonders(world);
    const ab = this.armyBounds(world);
    this.drawCorpses(world);
    this.drawArmyGround(ab);
    this.drawSortedWorld(world);
    this.drawArrows(world);
    this.drawArmyFlags(ab, world);
    this.drawSparks(world);
    this.drawBeasts(world);
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

        // WorldBox 是「平色块」：只保留极轻微的大尺度变化，不做每格颗粒
        // 跨格的大色斑：让地面有「块」的感觉，而不是一格一格拼出来的
        const low = vnoise(x * 0.075, y * 0.075, 3);
        const mid = vnoise(x * 0.21, y * 0.21, 17);
        let base = 0.94 + (low - 0.5) * 0.17 + (mid - 0.5) * 0.06;

        if (IS_LAND[t] && t !== T.Snow) {
          base *= 0.94 + (f / 255) * 0.12;
        }

        let br = pal[0] * base;
        let bg = pal[1] * base;
        let bb = pal[2] * base;

        // WorldBox 海岸是「阶梯式硬过渡」：不做颜色混合，靠地形层次本身的色差形成台阶

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

        // --- 水面：只有两级（深海 / 浅滩），硬切，WorldBox 不做渐变 ---
        if (t === T.Deep) {
          const nb8: [number, number][] = [
            [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
          ];
          for (const [dx, dy] of nb8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (IS_LAND[terrain[ny * w + nx]]) {
              const sp = PALETTE[1];
              br = sp[0] * base; bg = sp[1] * base; bb = sp[2] * base;
              break;
            }
          }
        }

        const fv = fire[i];
        const pv = plague[i];
        const fk = fv > 0 ? Math.min(1, fv / 150) : 0;
        const pk = pv > 0 ? Math.min(0.75, pv / 220) : 0;

        const below = y + 1 < h ? terrain[i + w] : T.Deep;
        const cliff = IS_LAND[t] && !IS_LAND[below] ? 0.85 : 1;

        const ox = x * T2;
        const oy = y * T2;
        const ep = EDGE[t] ?? EDGE[0];
        // 放大后边缘同步加粗，保持「方块」质感
        const ew = T2 >= 6 ? 2 : 1;
        const drawEdge = T2 >= 3;
        for (let py = 0; py < T2; py++) {
          const rowBase = (oy + py) * W + ox;
          for (let px = 0; px < T2; px++) {
            const grain = (h2(x * 31 + px, y * 37 + py) - 0.5) * 0.03;
            let s = 1 + grain;
            s *= cliff;

            // ---- 水面：波纹 + 岸边泡沫（WorldBox 的水不是纯色块）----
            if (!IS_LAND[t]) {
              // 缓慢移动的横向波纹：每 3px 一条微亮线
              const bandH = Math.max(2, Math.round(T2 / 4));
              const wave = Math.sin((y * 3 + py) * 0.5 + x * 0.7 + world.tick * 0.03);
              if (py % bandH === 0) s *= 1.1 + wave * 0.06;
              else if (py % bandH === bandH - 1) s *= 0.95;
              // 深水更深、浅水更亮，形成深度感
              if (t === T.Deep) s *= 0.9;
              // 岸边泡沫：四个方向贴陆都算，画 2px 宽的亮边
              const fw = Math.max(1, Math.round(T2 * 0.09));
              const nbU = y > 0 ? terrain[i - w] : t;
              const nbD = y + 1 < h ? terrain[i + w] : t;
              const nbL = x > 0 ? terrain[i - 1] : t;
              const nbR = x + 1 < w ? terrain[i + 1] : t;
              if ((IS_LAND[nbU] && py < fw) || (IS_LAND[nbD] && py >= T2 - fw)
                  || (IS_LAND[nbL] && px < fw) || (IS_LAND[nbR] && px >= T2 - fw)) {
                s *= 1.42;
              }
            }

            let cr: number;
            let cg: number;
            let cb: number;

            if (drawEdge && (py < ew || px < ew)) {
              // 上/左：亮边 —— 光从左上来，方块「凸起」
              cr = (br * 0.62 + ep[0] * 0.38) * s;
              cg = (bg * 0.62 + ep[1] * 0.38) * s;
              cb = (bb * 0.62 + ep[2] * 0.38) * s;
            } else if (drawEdge && (py >= T2 - ew || px >= T2 - ew)) {
              // 下/右：仍是亮边，但只混 20% —— WorldBox 是「底色+浅色内边」，
              // 不用暗边，否则相邻格子的亮暗边会拼成一张深色渔网
              cr = (br * 0.88 + ep[0] * 0.12) * s;
              cg = (bg * 0.88 + ep[1] * 0.12) * s;
              cb = (bb * 0.88 + ep[2] * 0.12) * s;
            } else {
              cr = br * s;
              cg = bg * s;
              cb = bb * s;
            }
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
    // 先把所有城镇的范围标出来：城里不长树、不堆石头
    const townClear = new Set<number>();
    for (const sc of world.settlements) {
      if (!sc.alive || sc.ruin) continue;
      const R = 3 + Math.floor(Math.sqrt(Math.max(1, sc.pop)) / 9);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const nx = sc.x + dx;
          const ny = sc.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          townClear.add(ny * w + nx);
        }
      }
    }
    const deco = this.decoSets(T2);
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * w + x;
        const t = terrain[i];
        const rnd = h2(x * 2654435761, y * 40503);
        const variant = Math.floor(h2(x * 7919, y * 104729) * 3) % 3;
        const cx = x * T2;
        const cy = y * T2;
        // 位置抖动：让树/石/草不要在格子里对齐成网格
        const jx = Math.round((h2(x * 17 + 5, y * 19 + 3) - 0.5) * T2 * 0.9);
        const jy = Math.round((h2(x * 23 + 11, y * 29 + 7) - 0.5) * T2 * 0.75);

        // 城内不长树：房子必须露出来（WorldBox 的城镇里也是干净的）
        if (townClear.has(i)) continue;

        if (t === T.Forest) {
          // 林地底色再压几个暗点：树与树之间的缝隙本来就有阴影
          if (T2 >= 3) {
            for (let k = 0; k < 3; k++) {
              const dx2 = cx + ((h2(x * 23 + k * 13, y * 37 + k * 5) * T2) | 0);
              const dy2 = cy + ((h2(x * 41 + k * 3, y * 19 + k * 7) * T2) | 0);
              if (dx2 > 0 && dy2 > 0 && dx2 < W - 1 && dy2 < H - 1) {
                buf[dy2 * W + dx2] = 0xff2e5a34;
              }
            }
          }
          // 密度随大尺度噪声变化：有的地方是密林，有的是林间空地
          const dens = vnoise(x * 0.13, y * 0.13, 23);
          if (rnd < 0.4 + dens * 0.55) {
            const sp = deco.forest[variant];
            blit(buf, W, H, sp, cx + ((T2 - sp.w) >> 1) + jx, cy + T2 - sp.h + Math.round(T2 * 0.2) + jy);
          }
        } else if (t === T.Grass) {
          // 草簇：每格撒 2~4 个 1px 深绿点。整片纯绿是最「假」的，
          // 撒点之后地面才有颗粒感 —— 这是 WorldBox 草地看起来「活」的小秘密
          if (T2 >= 3) {
            const dots = 2 + ((rnd * 3) | 0);
            for (let k = 0; k < dots; k++) {
              const dx2 = cx + ((h2(x * 13 + k * 7, y * 17 + k * 11) * T2) | 0);
              const dy2 = cy + ((h2(x * 29 + k * 5, y * 31 + k * 3) * T2) | 0);
              if (dx2 > 0 && dy2 > 0 && dx2 < W - 1 && dy2 < H - 1) {
                buf[dy2 * W + dx2] = k === 0 ? 0xff4a7a2c : 0xff5e8c36;
              }
            }
          }
          // 野花：极低概率，但一片草原上有几朵就活了
          if (T2 >= 5 && rnd > 0.972) {
            const fx2 = cx + ((h2(x * 61 + 7, y * 71 + 3) * (T2 - 2)) | 0) + 1;
            const fy2 = cy + ((h2(x * 83 + 5, y * 97 + 9) * (T2 - 2)) | 0) + 1;
            if (fx2 > 0 && fy2 > 0 && fx2 < W - 1 && fy2 < H - 1) {
              const kind = (h2(x * 5, y * 7) * 3) | 0;
              buf[fy2 * W + fx2] = kind === 0 ? 0xff8cc8f0 : kind === 1 ? 0xffe8e69c : 0xffc8a0f0;
              buf[fy2 * W + fx2 + 1] = 0xff3f7a2a;
            }
          }
          const dens = vnoise(x * 0.11, y * 0.11, 29);
          if (rnd < dens * 0.18) {
            const sp = deco.tree[variant];
            blit(buf, W, H, sp, cx + ((T2 - sp.w) >> 1) + jx, cy + T2 - sp.h + Math.round(T2 * 0.2) + jy);
          } else if (rnd < 0.22 + dens * 0.2) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Hill) {
          if (T2 >= 3) {
            for (let k = 0; k < 2; k++) {
              const dx2 = cx + ((h2(x * 31 + k * 7, y * 43 + k * 9) * T2) | 0);
              const dy2 = cy + ((h2(x * 53 + k * 5, y * 23 + k * 11) * T2) | 0);
              if (dx2 > 0 && dy2 > 0 && dx2 < W - 1 && dy2 < H - 1) {
                buf[dy2 * W + dx2] = k === 0 ? 0xff6a6c62 : 0xff7c7e72;
              }
            }
          }
          if (rnd < 0.16) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          } else if (rnd < 0.26) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Mountain) {
          // 山脊积雪：上方不是山的格子就是山脊线，压一道白 —— 山的「高度感」全靠这一道
          const up = y > 0 ? terrain[(y - 1) * w + x] : T.Mountain;
          if (up !== T.Mountain && T2 >= 4) {
            for (let px2 = 0; px2 < T2; px2++) {
              const xx = cx + px2;
              if (xx < 0 || xx >= W) continue;
              buf[cy * W + xx] = 0xfff2f2e8;
              if (T2 >= 6) buf[(cy + 1) * W + xx] = 0xffd8e4e4;
            }
          }
          if (rnd < 0.4) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Snow) {
          if (rnd < 0.12) {
            const sp = deco.snowRock[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Swamp) {
          if (rnd < 0.28) {
            const sp = deco.puddle[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          } else if (rnd < 0.5) {
            const sp = deco.bush[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Sand) {
          if (rnd < 0.05) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
          }
        } else if (t === T.Ruin) {
          if (rnd < 0.35) {
            const sp = deco.rock[variant];
            blit(buf, W, H, sp, cx + jx, cy + T2 - sp.h + jy);
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

  // ==================== 单位（真实个体）====================

  /**
   * 画每一个市民。真正的绘制在 paintUnit 里（图鉴脚本也用同一份代码，
   * 以保证「验证过的样子」和「游戏里的样子」是同一件事）。
   */
  /** 把单位按 y 排好（供和建筑归并绘制） */
  private sortUnits(world: World): World['units'] {
    const list = this._unitList;
    list.length = 0;
    for (const u of world.units) list.push(u);
    list.sort((a, b) => a.y - b.y);
    return list;
  }

  /** 画一个单位（抽出来，供归并绘制逐个调用） */
  private paintOneUnit(world: World, u: World['units'][number], now: number): void {
    const z = this.cam.zoom;
    if (z < 6) return;
    const { ctx } = this;
    {
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      if (sx < -24 || sy < -24 || sx > this.cssW + 24 || sy > this.cssH + 24) return;
      const look = RACE_LOOK[u.race] ?? RACE_LOOK[0];
      const kid = u.job === 'child';
      const extra = u.role === 'general' ? 0.43 : u.role === 'archer' ? 0.37 : 0.4;
      const rawH = z * (kid ? 0.2 : extra) * look.h;
      const H = rawH >= 27 ? 30 : rawH >= 23 ? 26 : rawH >= 19 ? 22 : rawH >= 15 ? 18 : Math.max(6, Math.round(rawH));
      const W = Math.max(3, Math.round(H * 0.56 * look.w));
      const flag = world.nations[u.nation]?.color ?? '#c8492f';
      paintUnit(ctx, sx, sy, H, W, u, look, now, flag);
      if (u.flash !== undefined && u.flash > world.tick) {
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillRect(Math.round(sx - W / 2) - 1, Math.round(sy - H / 2), W + 2, H);
      }
    }
  }

  /**
   * 建筑 + 人，按 y 归并绘制。
   * 这是整张图「有前后层次」的唯一来源：谁脚底更靠下（离镜头近），谁后画、谁盖住别人。
   */
  private drawSortedWorld(world: World): void {
    const z = this.cam.zoom;
    if (z < 3) {
      this.drawUnitsAll(world);
      return;
    }
    const now = Date.now();
    const list = this.sortUnits(world);
    const pend = this._pending;
    pend.sort((a, b) => a.wy - b.wy);

    let ui = 0;
    for (const p of pend) {
      while (ui < list.length && list[ui].y < p.wy) this.paintOneUnit(world, list[ui++], now);
      p.draw();
    }
    while (ui < list.length) this.paintOneUnit(world, list[ui++], now);
  }

  /** 低倍视野下不排序，一把画完（省得每帧排 600 个） */
  private drawUnitsAll(world: World): void {
    const now = Date.now();
    for (const u of world.units) this.paintOneUnit(world, u, now);
  }

  private drawUnits(world: World): void {
    const z = this.cam.zoom;
    if (z < 6 || !world.units?.length) return;
    const { ctx } = this;
    const now = Date.now();

    // 俯视视角里必须「前面的人盖住后面的人」：先按 y 排一遍，
    // 否则一群人看起来像并排贴纸，没有前后层次。
    const list = this._unitList;
    list.length = 0;
    for (const u of world.units) list.push(u);
    list.sort((a, b) => a.y - b.y);

    for (const u of list) {
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      if (sx < -24 || sy < -24 || sx > this.cssW + 24 || sy > this.cssH + 24) continue;
      const look = RACE_LOOK[u.race] ?? RACE_LOOK[0];
      const kid = u.job === 'child';
      // 人约房子的 1/3 高：再小就看不见脸，再大就不像城
      const extra = u.role === 'general' ? 0.43 : u.role === 'archer' ? 0.37 : 0.4;
      // 身高吸附到 18 / 22 / 26 / 30 四档：像素小人必须在固定网格上画，
      // 每帧浮动的 H 会让 1px 的细节时有时无（这是「看着糊」的真正原因之一）。
      const rawH = z * (kid ? 0.2 : extra) * look.h;
      const H = rawH >= 27 ? 30 : rawH >= 23 ? 26 : rawH >= 19 ? 22 : rawH >= 15 ? 18 : Math.max(6, Math.round(rawH));
      const W = Math.max(3, Math.round(H * 0.56 * look.w));
      const flag = world.nations[u.nation]?.color ?? '#c8492f';
      paintUnit(ctx, sx, sy, H, W, u, look, now, flag);
      // 受击白光：被砍到的那一瞬间整个人闪一下白，缩到远景也看得见
      if (u.flash !== undefined && u.flash > world.tick) {
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillRect(Math.round(sx - W / 2) - 1, Math.round(sy - H / 2), W + 2, H);
      }
    }
  }

  // ==================== 战场图层 ====================

  /** 尸体：躺倒的小人。它让战场留下痕迹，而不是打完就干净得像没事发生。 */
  private drawCorpses(world: World): void {
    if (!world.corpses?.length) return;
    const z = this.cam.zoom;
    if (z < 5) return;
    const { ctx } = this;
    for (const c of world.corpses) {
      const [sx, sy] = this.worldToScreen(c.x, c.y);
      if (sx < -20 || sy < -20 || sx > this.cssW + 20 || sy > this.cssH + 20) continue;
      const look = RACE_LOOK[c.race] ?? RACE_LOOK[0];
      const H = Math.max(3, Math.round(z * 0.28));
      const W = Math.max(2, Math.round(H * 0.5));
      const fade = c.age > 600 ? 0.45 : 1;
      // 血泊：一小片暗红，让它比草地上任何东西都暗一档
      if (z >= 10) {
        ctx.fillStyle = `rgba(88,18,14,${0.42 * fade})`;
        ctx.fillRect(Math.round(sx - H * 0.65), Math.round(sy - 1), Math.round(H * 1.3), Math.max(2, Math.round(W * 0.9)));
        ctx.fillStyle = `rgba(120,26,20,${0.3 * fade})`;
        ctx.fillRect(Math.round(sx - H * 0.45), Math.round(sy), Math.round(H * 0.9), Math.max(1, Math.round(W * 0.5)));
      }
      // 身体横躺：宽度=身高，高度=肩宽；外面一圈深色描边保证在草地上不糊
      ctx.fillStyle = `rgba(14,10,8,${0.55 * fade})`;
      ctx.fillRect(Math.round(sx - H * 0.5) + 1, Math.round(sy + 2), H + 1, Math.max(2, W * 0.75));
      ctx.fillStyle = look.cloth2;
      ctx.fillRect(Math.round(sx - H * 0.5), Math.round(sy), Math.round(H * 0.72), W);
      ctx.fillStyle = look.skin;
      ctx.fillRect(Math.round(sx + H * 0.22), Math.round(sy), Math.max(1, Math.round(W * 0.9)), Math.max(1, W));
      if (z >= 12) {
        ctx.fillStyle = look.hair;
        ctx.fillRect(Math.round(sx + H * 0.22), Math.round(sy), Math.max(1, Math.round(W * 0.9)), 1);
      }
    }
  }

  /** 箭矢：一根亮线 + 一段更淡的拖尾 */
  private drawArrows(world: World): void {
    if (!world.arrows?.length) return;
    const z = this.cam.zoom;
    if (z < 6) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'butt';
    for (const a of world.arrows) {
      if (!a.active) continue;
      const [sx, sy] = this.worldToScreen(a.x, a.y);
      if (sx < -20 || sy < -20 || sx > this.cssW + 20 || sy > this.cssH + 20) continue;
      const sp = Math.hypot(a.vx, a.vy) || 1;
      const ux = a.vx / sp;
      const uy = a.vy / sp;
      const len = Math.max(4, Math.min(22, z * 0.42));
      ctx.strokeStyle = 'rgba(255,252,236,1)';
      ctx.lineWidth = Math.max(2, Math.round(z / 26));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - ux * len, sy - uy * len);
      ctx.stroke();
      // 拖尾：三倍半长、两层色阶，远看是一条白线
      ctx.strokeStyle = 'rgba(240,248,255,0.45)';
      ctx.lineWidth = Math.max(1, Math.round(z / 40));
      ctx.beginPath();
      ctx.moveTo(sx - ux * len, sy - uy * len);
      ctx.lineTo(sx - ux * len * 3.4, sy - uy * len * 3.4);
      ctx.stroke();
      // 箭头：一个亮点
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, Math.max(2, Math.round(z / 32)), Math.max(2, Math.round(z / 32)));
    }
    ctx.restore();
  }

  /** 火花：所有粒子攒成一条路径，一次画完 */
  private drawSparks(world: World): void {
    if (!world.sparks?.length) return;
    const z = this.cam.zoom;
    if (z < 6) return;
    const { ctx } = this;
    const size = Math.max(1, Math.round(z * 0.045));
    for (let kind = 0; kind < 3; kind++) {
      let any = false;
      ctx.beginPath();
      for (const s of world.sparks) {
        if (s.kind !== kind) continue;
        const [sx, sy] = this.worldToScreen(s.x, s.y);
        if (sx < -10 || sy < -10 || sx > this.cssW + 10 || sy > this.cssH + 10) continue;
        const k = s.life / s.max;
        // 血花比火花大一号：它得让人「看见血」，而不只是看见有个像素在动
        const sz = Math.max(1, Math.round(size * (0.5 + k) * (kind === 0 ? 1.8 : 1)));
        ctx.rect(Math.round(sx), Math.round(sy), sz, sz);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = kind === 0
        ? 'rgba(206,46,32,0.9)'
        : kind === 1
          ? 'rgba(255,246,206,0.95)'
          : 'rgba(150,140,120,0.6)';
      ctx.fill();
    }
  }

  // ==================== 军队 ====================

  /** 每帧算一次各军队的包围盒，地面阴影 / 旗标 / 血条共用，避免重复遍历 */
  private armyBounds(
    world: World,
  ): { a: World['armies'][number]; x0: number; y0: number; x1: number; y1: number }[] {
    const out: { a: World['armies'][number]; x0: number; y0: number; x1: number; y1: number }[] = [];
    if (!world.armies?.length) return out;
    for (const a of world.armies) {
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      let n = 0;
      for (const u of world.units) {
        if (u.army !== a.id) continue;
        n++;
        if (u.x < x0) x0 = u.x;
        if (u.x > x1) x1 = u.x;
        if (u.y < y0) y0 = u.y;
        if (u.y > y1) y1 = u.y;
      }
      if (n < 3) continue;
      out.push({ a, x0, y0, x1, y1 });
    }
    return out;
  }

  /**
   * 军队脚下的暗影。
   * 它的作用不是「好看」，是让一支部队在远景 zoom 8~16 时也能被认出来：
   * 二十几个 5px 的小人本来会化成一堆杂点，有了这层底板就变成「一块在动的东西」。
   */
  private drawArmyGround(boxes: ReturnType<Renderer['armyBounds']>): void {
    const z = this.cam.zoom;
    if (z < 4) return;
    const { ctx } = this;
    for (const b of boxes) {
      const [sx0, sy0] = this.worldToScreen(b.x0 - 0.18, b.y0 - 0.14);
      const [sx1, sy1] = this.worldToScreen(b.x1 + 0.18, b.y1 + 0.2);
      if (sx1 < -80 || sy1 < -80 || sx0 > this.cssW + 80 || sy0 > this.cssH + 80) continue;
      const w = Math.max(10, Math.round(sx1 - sx0));
      const h = Math.max(8, Math.round(sy1 - sy0));
      const x = Math.round(sx0);
      const y = Math.round(sy0);
      // 两层：外圈更淡，内圈更深 —— 像素风里靠两层色阶表现「压下去」
      ctx.fillStyle = 'rgba(10,16,10,0.22)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = 'rgba(10,16,10,0.26)';
      ctx.fillRect(x + 1, y + 2, w - 2, h - 2);
    }
  }

  /**
   * 军队的旗标与血条。
   *
   * 远看（zoom < 26）时小人身上的旗只有 2×3 像素，等于看不见；
   * 所以这里按屏幕尺寸补一个旗标 —— 战争片里「军旗」本来就该是最先被看见的东西。
   */
  private drawArmyFlags(boxes: ReturnType<Renderer['armyBounds']>, world: World): void {
    const z = this.cam.zoom;
    if (z < 4) return;
    const { ctx } = this;

    for (const b of boxes) {
      const a = b.a;
      const col = world.nations[a.nation]?.color ?? '#c8492f';
      const g = world.units.find((u) => u.id === a.general);
      const gx = g ? g.x : a.x;
      const gy = g ? g.y : a.y;
      const [sx, sy] = this.worldToScreen(gx, gy);
      const bob = Math.floor(Date.now() / 260) % 2;

      // ---- 远景旗标 ----
      if (z < 26) {
        const ph = Math.max(9, Math.min(26, Math.round(z * 0.9)));
        const pw = Math.max(6, Math.round(ph * 0.62));
        const px = Math.round(sx) + 1;
        const py = Math.round(sy) - Math.round(ph * 0.6);
        ctx.fillStyle = 'rgba(16,12,8,0.85)';
        ctx.fillRect(px, py, Math.max(1, Math.round(ph * 0.09)) + 1, ph);
        ctx.fillStyle = col;
        ctx.fillRect(px + 1, py - bob, pw, Math.max(3, Math.round(ph * 0.42)));
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(px + 1, py - bob, pw, 1);
      }

      // ---- 血条：只有 2px 高，细到像一根线 ----
      const [sxB0] = this.worldToScreen(b.x0 - 0.25, 0);
      const [sxB1] = this.worldToScreen(b.x1 + 0.25, 0);
      const [, syTop] = this.worldToScreen(0, b.y0 - 0.44);
      const bw = Math.max(12, Math.round(sxB1 - sxB0));
      const bx = Math.round(sxB0);
      const by = Math.round(syTop);
      const st = Math.max(0, Math.min(1, a.strength));
      ctx.fillStyle = 'rgba(8,10,8,0.62)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
      ctx.fillStyle = st > 0.7 ? '#6fd45a' : st > 0.35 ? '#e8b83c' : '#d4442c';
      ctx.fillRect(bx, by, Math.max(1, Math.round(bw * st)), 2);
    }
  }

  // ==================== 世界奇观 ====================

  /**
   * 已建成的奇观。它是整张地图上唯一「超出比例尺」的建筑，
   * 远看就能认出「那座城不一样」—— 这就是奇观该有的视觉重量。
   */
  private drawWonders(world: World): void {
    const z = this.cam.zoom;
    if (z < 4 || !world.wonders?.length) return;
    const { ctx } = this;

    for (const w of world.wonders) {
      if (!w.built) continue;
      const s = world.settlements[w.city];
      if (!s) continue;
      const [sx, sy] = this.worldToScreen(s.x + 0.5, s.y + 0.5);
      if (sx < -120 || sy < -120 || sx > this.cssW + 120 || sy > this.cssH + 120) continue;

      const u = Math.max(2, Math.round(z * 0.78));
      const cx = Math.round(sx);
      const by = Math.round(sy + u * 1.6); // 建筑底边

      ctx.save();

      // 圣地：先在脚下铺一圈空地，环绕一圈更亮的草色，
      // 让它周围的树「退开」—— 奇观必须有一块专属的地面
      const pad = u * 7.5;
      ctx.fillStyle = 'rgba(118,177,83,0.95)';
      ctx.beginPath();
      ctx.ellipse(cx, by, pad, pad * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,220,106,0.95)';
      ctx.beginPath();
      ctx.ellipse(cx, by, pad * 0.74, pad * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(209,231,113,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, by, pad * 0.46, pad * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();

      // 光晕：让它在远看时也跳出来
      const halo = ctx.createRadialGradient(cx, by - u * 3, u, cx, by - u * 3, u * 9);
      halo.addColorStop(0, 'rgba(255,236,160,0.22)');
      halo.addColorStop(1, 'rgba(255,236,160,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - u * 9, by - u * 12, u * 18, u * 18);

      if (w.kind === 1) {
        // ---- 精灵：月桂母树（一棵大到不合比例的树）----
        const trunkW = u * 3.4;
        ctx.fillStyle = 'rgba(12,30,14,0.34)';
        ctx.beginPath();
        ctx.ellipse(cx, by + u * 0.4, u * 8.2, u * 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        // 树干
        ctx.fillStyle = '#4a3524';
        ctx.fillRect(cx - trunkW / 2, by - u * 7.5, trunkW, u * 7.5);
        ctx.fillStyle = '#63472f';
        ctx.fillRect(cx - trunkW / 2, by - u * 7.5, Math.max(1, trunkW * 0.45), u * 7.5);
        // 树冠：三层
        const canopy = (cy: number, r: number, col: string) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r, r * 0.72, 0, 0, Math.PI * 2);
          ctx.fill();
        };
        canopy(by - u * 7.2, u * 7.4, '#174f18');
        canopy(by - u * 8.6, u * 6.2, '#1F7020');
        canopy(by - u * 10.2, u * 4.8, '#2f8a36');
        canopy(by - u * 11.6, u * 3.4, '#46A052');
        canopy(by - u * 12.6, u * 2.0, '#8ACF55');
        // 金色光点
        ctx.fillStyle = 'rgba(255,226,140,0.85)';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.fillRect(
            Math.round(cx + Math.cos(a) * u * 5.2),
            Math.round(by - u * 9.6 + Math.sin(a) * u * 3.4),
            Math.max(1, u * 0.6),
            Math.max(1, u * 0.6),
          );
        }
      } else if (w.kind === 0) {
        // ---- 人类：万卷之城（白色圆顶 + 柱廊）----
        const wdt = u * 8;
        const hgt = u * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(cx, by, u * 4.6, u * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
        // 主体
        ctx.fillStyle = '#d9d2bd';
        ctx.fillRect(cx - wdt / 2, by - hgt, wdt, hgt);
        ctx.fillStyle = '#b8b09a';
        ctx.fillRect(cx + wdt * 0.2, by - hgt, wdt * 0.3, hgt);
        // 柱廊
        ctx.fillStyle = '#f0ead6';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(cx - wdt / 2 + u * 0.6 + i * u * 1.6, by - hgt, u * 0.7, hgt);
        }
        // 圆顶
        ctx.fillStyle = '#7fa8c9';
        ctx.beginPath();
        ctx.ellipse(cx, by - hgt, u * 2.4, u * 2.2, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a8cbe0';
        ctx.beginPath();
        ctx.ellipse(cx - u * 0.7, by - hgt - u * 0.7, u * 1.1, u * 1.2, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        // 塔尖
        ctx.fillStyle = '#ffd447';
        ctx.fillRect(cx - u * 0.25, by - hgt - u * 3.1, Math.max(1, u * 0.5), u * 1.0);
      } else if (w.kind === 2) {
        // ---- 矮人：深炉（黑色高塔 + 炉口红光）----
        const wdt = u * 5;
        const hgt = u * 9;
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.ellipse(cx, by, u * 3.6, u * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
        // 塔身（上窄下宽）
        ctx.fillStyle = '#3a3a3c';
        ctx.beginPath();
        ctx.moveTo(cx - wdt / 2, by);
        ctx.lineTo(cx + wdt / 2, by);
        ctx.lineTo(cx + wdt * 0.3, by - hgt);
        ctx.lineTo(cx - wdt * 0.3, by - hgt);
        ctx.closePath();
        ctx.fill();
        // 亮面
        ctx.fillStyle = '#585a5c';
        ctx.beginPath();
        ctx.moveTo(cx - wdt / 2, by);
        ctx.lineTo(cx - wdt * 0.12, by);
        ctx.lineTo(cx - wdt * 0.08, by - hgt);
        ctx.lineTo(cx - wdt * 0.3, by - hgt);
        ctx.closePath();
        ctx.fill();
        // 炉口：脉动的红光
        const glow = 0.55 + Math.sin(Date.now() / 240) * 0.35;
        ctx.fillStyle = `rgba(246,45,20,${glow.toFixed(2)})`;
        ctx.fillRect(cx - u * 0.9, by - u * 2.2, u * 1.8, u * 1.6);
        ctx.fillStyle = `rgba(240,177,33,${(glow * 0.9).toFixed(2)})`;
        ctx.fillRect(cx - u * 0.5, by - u * 1.9, u * 1.0, u * 1.0);
        // 塔尖
        ctx.fillStyle = '#6a6a6c';
        ctx.fillRect(cx - u * 0.2, by - hgt - u * 1.2, Math.max(1, u * 0.4), u * 1.2);
      } else {
        // ---- 兽人：万骨塔（白骨堆成的塔）----
        const wdt = u * 6;
        const hgt = u * 7;
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath();
        ctx.ellipse(cx, by, u * 3.8, u * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d8d2c0';
        ctx.beginPath();
        ctx.moveTo(cx - wdt / 2, by);
        ctx.lineTo(cx + wdt / 2, by);
        ctx.lineTo(cx + u * 0.9, by - hgt);
        ctx.lineTo(cx - u * 0.9, by - hgt);
        ctx.closePath();
        ctx.fill();
        // 骨节横纹
        ctx.fillStyle = '#a89e88';
        for (let i = 1; i < 6; i++) {
          ctx.fillRect(cx - wdt / 2 + u * i * 0.32, by - u * i * 1.1, wdt - i * u * 0.64, Math.max(1, u * 0.35));
        }
        // 顶上的兽颅
        ctx.fillStyle = '#efe7d2';
        ctx.fillRect(cx - u * 1.1, by - hgt - u * 1.4, u * 2.2, u * 1.4);
        ctx.fillStyle = '#2a1a12';
        ctx.fillRect(cx - u * 0.7, by - hgt - u * 1.0, Math.max(1, u * 0.4), Math.max(1, u * 0.4));
        ctx.fillRect(cx + u * 0.3, by - hgt - u * 1.0, Math.max(1, u * 0.4), Math.max(1, u * 0.4));
        // 顶上的红布
        ctx.fillStyle = '#d9483a';
        ctx.fillRect(cx + u * 1.0, by - hgt - u * 1.6, Math.max(1, u * 0.4), u * 1.8);
      }

      ctx.restore();
    }
  }

  // ==================== 巨兽 ====================

  /**
   * 远古巨兽。俯瞰尺度下画成「暗红肉块 + 两只黄眼」就够了 ——
   * 它存在的意义是让人一眼看到「那里有东西，而且它不该在那儿」。
   */
  private drawBeasts(world: World): void {
    const z = this.cam.zoom;
    if (z < 3) return;
    const { ctx } = this;
    const fr = Math.floor(Date.now() / 200); // 呼吸节奏：每 200ms 一变

    for (const b of world.beasts) {
      if (!b.alive) continue;
      const [sx, sy] = this.worldToScreen(b.x + 0.5, b.y + 0.5);
      if (sx < -100 || sy < -100 || sx > this.cssW + 100 || sy > this.cssH + 100) continue;

      const big = b.tier === 0;
      // 单位：小方块边长
      const u = Math.max(1, Math.round(z * (big ? 0.34 : 0.26)));
      const W = u * 9;
      const H = u * 7;
      const x0 = Math.round(sx - W / 2);
      const y0 = Math.round(sy - H / 2);
      const P = (cx: number, cy: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(x0 + cx * u, y0 + cy * u, w * u, h * u);
      };

      // 地面暗影
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + H * 0.42, W * 0.52, H * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      const OUTLINE = '#1a0a12';
      const DARK = big ? '#5a1c2b' : '#4a1f38';
      const BODY = big ? '#8d2f40' : '#6d3350';
      const LIT = big ? '#b44a52' : '#8a4568';
      const SPIKE = '#2a0f1c';

      // 深色轮廓：先铺一整块，再在上面叠身体 —— 保证剪影清晰
      P(1, 2, 7, 4, OUTLINE);
      P(2, 1, 5, 1, OUTLINE);
      P(0, 3, 9, 2, OUTLINE);

      // 背棘（3 根尖）
      for (let i = 0; i < 3; i++) {
        const sxk = 2 + i * 2;
        P(sxk, 0, 1, 2, SPIKE);
        P(sxk, 1, 1, 1, LIT);
      }

      // 躯干
      P(1, 3, 7, 3, BODY);
      P(2, 2, 5, 1, BODY);
      // 高光（顶部）
      P(2, 3, 4, 1, LIT);
      // 腹甲（横向条纹）
      P(2, 5, 5, 1, DARK);
      P(1, 4, 1, 1, DARK);

      // 四肢
      P(1, 6, 2, 1, DARK);
      P(6, 6, 2, 1, DARK);

      // 头（朝下）
      P(3, 6, 3, 1, BODY);

      // 眼：呼吸式明灭
      const pulse = 0.55 + Math.sin(fr * 0.25 + b.id * 2.1) * 0.45;
      ctx.fillStyle = `rgba(255,196,64,${pulse.toFixed(2)})`;
      ctx.fillRect(x0 + 3 * u, y0 + 3 * u, u, u);
      ctx.fillRect(x0 + 5 * u, y0 + 3 * u, u, u);

      // 受伤：血痕
      if (b.hp < b.maxHp * 0.5) {
        P(2, 4, 1, 1, '#ff6a4a');
        P(6, 4, 1, 2, '#ff6a4a');
      }
    }
  }

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
    // 路基（深土色压底，让路从草地/沙地里"跳"出来）
    ctx.strokeStyle = 'rgba(92,70,44,0.62)';
    ctx.lineWidth = Math.max(4.2, z * 0.64);
    for (const [[ax, ay], [bx, by]] of segs) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    // 路面（踩实的浅土色）
    ctx.strokeStyle = 'rgba(226,200,150,0.95)';
    ctx.lineWidth = Math.max(2, z * 0.28);
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
    // 视角没变就复用上一帧的建筑队列：几百个闭包每帧重建，白扔 4~6ms
    const sig = `${z}|${Math.round(this.cam.x * 4)}|${Math.round(this.cam.y * 4)}`;
    const rebuild = sig !== this._pendingSig;
    if (rebuild) {
      this._pendingSig = sig;
      this._pending.length = 0;
    }

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
        const half = unit * 2.05;
        const thick = Math.max(3, Math.round(unit * 0.24));
        const stone = s.walls >= 2 ? '#8c8878' : '#7a7462';
        const stoneLit = s.walls >= 2 ? '#a8a496' : '#948d78';

        // 落地投影（墙是立起来的，必须有影子）
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.fillRect(sx - half + 2, sy + half - 2, half * 2, thick * 0.7);

        // 四面墙
        ctx.fillStyle = stone;
        ctx.fillRect(sx - half, sy - half, half * 2, thick);
        ctx.fillRect(sx - half, sy + half - thick, half * 2, thick);
        ctx.fillRect(sx - half, sy - half, thick, half * 2);
        ctx.fillRect(sx + half - thick, sy - half, thick, half * 2);
        // 墙顶受光
        ctx.fillStyle = stoneLit;
        ctx.fillRect(sx - half, sy - half, half * 2, Math.max(1, thick * 0.34));
        ctx.fillRect(sx - half, sy - half, Math.max(1, thick * 0.34), half * 2);
        // 石缝
        ctx.fillStyle = 'rgba(30,28,22,0.24)';
        for (let k = 1; k < 6; k++) {
          const seg = (half * 2 * k) / 6;
          ctx.fillRect(sx - half + seg, sy - half, 1, thick);
          ctx.fillRect(sx - half + seg, sy + half - thick, 1, thick);
          ctx.fillRect(sx - half, sy - half + seg, thick, 1);
          ctx.fillRect(sx + half - thick, sy - half + seg, thick, 1);
        }

        // 垛口（城墙上一个个凸起）
        const merlon = Math.max(2, Math.round(thick * 0.7));
        ctx.fillStyle = stoneLit;
        const perSide = Math.max(4, Math.round(half / unit));
        for (let k = 0; k < perSide; k++) {
          const t = (k + 0.5) / perSide;
          const mx = Math.round(sx - half + half * 2 * t - merlon / 2);
          ctx.fillRect(mx, Math.round(sy - half - merlon * 0.5), merlon, merlon);
          ctx.fillRect(mx, Math.round(sy + half - thick + merlon * 0.5), merlon, merlon);
        }
        for (let k = 0; k < perSide; k++) {
          const t = (k + 0.5) / perSide;
          const my = Math.round(sy - half + half * 2 * t - merlon / 2);
          ctx.fillRect(Math.round(sx - half - merlon * 0.5), my, merlon, merlon);
          ctx.fillRect(Math.round(sx + half - thick + merlon * 0.5), my, merlon, merlon);
        }

        // 城门：门洞 + 门楼
        const gate = Math.max(4, Math.round(unit * 0.5));
        ctx.fillStyle = '#2e2418';
        ctx.fillRect(sx - gate / 2, sy + half - thick - 1, gate, thick + 2);
        ctx.fillStyle = '#4a3a24';
        ctx.fillRect(sx - gate / 2 + 1, sy + half - thick, gate - 2, thick);
        // 门楼（比墙高）
        const gh = Math.round(unit * 0.55);
        ctx.fillStyle = stone;
        ctx.fillRect(sx - gate * 0.9, sy + half - thick - gh, gate * 1.8, gh);
        ctx.fillStyle = stoneLit;
        ctx.fillRect(sx - gate * 0.9, sy + half - thick - gh, gate * 1.8, Math.max(1, gh * 0.28));
        ctx.fillStyle = '#2e2418';
        ctx.fillRect(sx - gate / 2, sy + half - thick - gh * 0.7, gate, gh * 0.7);

        // 角楼
        const tw = Math.max(4, Math.round(unit * 0.45));
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const tx = sx + dx * half - tw / 2;
          const ty = sy + dy * half - tw / 2;
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(tx + 2, ty + 2, tw, tw);
          ctx.fillStyle = s.walls >= 2 ? '#6e6a5c' : '#5e5643';
          ctx.fillRect(tx, ty, tw, tw);
          ctx.fillStyle = stoneLit;
          ctx.fillRect(tx, ty, tw, Math.max(1, tw * 0.3));
        }
      }

      // ---- 建筑群：先算位置 → 铺道路 → 再盖房子 ----
      const spread = unit * (s.walls > 0 ? 1.5 : 1.75);
      const roof = shade(race.rgb, 0.98);
      const roofDark = shade(race.rgb, 0.6);
      const seed = s.id * 7919 + 13;
      const wallBase = ['#f4ecd6', '#e6dcc0', '#9a9a94', '#7a5f42'][s.race] ?? '#f4ecd6';
      const wallLit = wallBase;
      const wallDim = shade(hexToRgb(wallBase), 0.9);

      // 城内地面：被踩实的土，一眼看出「这里是人住的地方」
      const gR = spread * 1.45;
      ctx.fillStyle = 'rgba(146,120,84,0.5)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, gR, gR * 0.74, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(168,140,100,0.42)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, gR * 0.72, gR * 0.54, 0, 0, Math.PI * 2);
      ctx.fill();

      type BKind = 'house' | 'workshop' | 'granary' | 'barracks' | 'temple' | 'tower';
      const plan: { kind: BKind; ring: number }[] = [];
      const houseN = [2, 3, 4, 5, 7][Math.min(4, s.tier)] ?? 2;
      for (let i = 0; i < houseN; i++) plan.push({ kind: 'house', ring: i < 2 ? 0 : 1 });
      if (s.tier >= 1) plan.push({ kind: 'granary', ring: 1 });
      if (s.tier >= 1) plan.push({ kind: 'workshop', ring: 1 });
      if (s.tier >= 2) plan.push({ kind: 'temple', ring: 1 });
      if (s.tier >= 3) plan.push({ kind: 'barracks', ring: 1 });
      if (s.tier >= 3) plan.push({ kind: 'tower', ring: 1 });

      type Spot = { kind: BKind; x: number; y: number; j: number };
      const spots: Spot[] = [];
      for (const ring of [0, 1]) {
        const list = plan.filter((q) => q.ring === ring);
        const per = list.length;
        if (!per) continue;
        for (let k = 0; k < per; k++) {
          const b = list[k];
          // 角度和半径都要大幅抖动，否则房子会排成一个整齐的圆环 —— 那是最像「程序生成」的破绽
          const a = (k / per) * Math.PI * 2
            + (ring === 0 ? Math.PI / 4 : Math.PI / 7)
            + (h2(seed + (ring ? 500 : 0), k) - 0.5) * 1.15;
          const rr = spread * (ring === 0 ? 0.46 : 1) * (0.72 + h2(seed + 41 + (ring ? 500 : 0), k) * 0.58);
          spots.push({
            kind: b.kind,
            x: sx + Math.cos(a) * rr,
            y: sy + Math.sin(a) * rr * 0.7,
            j: 0.9 + h2(seed + 900 + plan.length, k + ring * 20) * 0.22,
          });
        }
      }

      // 街道：从中心广场向每栋建筑铺一条土路
      {
        const roadW = Math.max(2, Math.round(unit * (s.tier >= 2 ? 0.1 : 0.08)));
        ctx.lineCap = 'round';
        // 先铺深色路基，再压亮色路面 —— 否则路会陷进土色地面里看不见
        ctx.strokeStyle = 'rgba(104,80,52,0.55)';
        ctx.lineWidth = roadW * 1.5;
        for (const sp of spots) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sp.x, sp.y);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(222,200,146,0.92)';
        ctx.lineWidth = roadW;
        for (const sp of spots) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sp.x, sp.y);
          ctx.stroke();
        }
        // 外环再连一圈，形成环城路
        if (spots.length > 3) {
          ctx.strokeStyle = 'rgba(196,168,124,0.4)';
          ctx.lineWidth = Math.max(1, roadW - 1);
          ctx.beginPath();
          let first = true;
          for (const sp of spots) {
            if (first) { ctx.moveTo(sp.x, sp.y); first = false; }
            else ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }

      // 广场
      if (s.tier >= 1) {
        ctx.fillStyle = 'rgba(158,152,142,0.7)';
        const pz = unit * 0.42;
        ctx.fillRect(Math.round(sx - pz), Math.round(sy - pz * 0.7), Math.round(pz * 2), Math.round(pz * 1.4));
        ctx.fillStyle = 'rgba(178,172,160,0.5)';
        ctx.fillRect(Math.round(sx - pz * 0.7), Math.round(sy - pz * 0.48), Math.round(pz * 1.4), Math.round(pz * 0.96));
      }

      const placed: { x: number; y: number; w: number; h: number }[] = [];
      // 第一帧顺手把每栋房子换算成世界坐标写回模拟层 ——
      // 单位要靠这份清单才知道「这几格是墙，不能站」。
      const collect = !s.spots || s.spots.length === 0;
      if (collect) s.spots = [];
      for (const sp of spots) {
        const bx = sp.x;
        const by = sp.y;
        const jit = sp.j;
        // 脚底 y：建筑中心的下沿，和人的 u.y 同一坐标系，才能一起排序
        const wy = s.y + (by - sy) / z + 0.62;
        if (collect) {
          s.spots!.push({
            x: s.x + (bx - sx) / z,
            y: s.y + (by - sy) / z,
            r: (sp.kind === 'tower' ? 0.34 : sp.kind === 'temple' ? 0.55 : 0.46) * jit,
          });
        }
        // 每栋房子的屋顶深浅略不同，避免整片一样
        const rv = 0.9 + h2(seed + 77, Math.round(bx * 13 + by * 7)) * 0.24;
        const rf = shade(race.rgb.map((c) => c * rv) as [number, number, number], 0.98);
        const rfd = shade(race.rgb.map((c) => c * rv) as [number, number, number], 0.6);

        if (sp.kind === 'house') {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawHouse(bx, by, unit * 0.95 * jit, unit * 0.92 * jit, rf, rfd, jit > 1, true, s.race) });
          placed.push({ x: bx, y: by, w: unit * 0.95 * jit, h: unit * 0.92 * jit });
        } else if (sp.kind === 'workshop') {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawStruct(bx, by, unit * 1.05, unit * 0.95, {
            race: s.race, wall: wallDim, roof: rf, roofDark: rfd,
            roofType: s.race === 2 ? 'flat' : 'gable',
            addons: ['belfry', 'goods'], lit: true,
          }) });;
          placed.push({ x: bx, y: by, w: unit * 1.05, h: unit * 0.95 });
        } else if (sp.kind === 'granary') {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawStruct(bx, by, unit * 0.92, unit * 1.05, {
            race: s.race, wall: wallLit, roof: shade([214, 178, 92], 1), roofDark: shade([170, 138, 66], 1),
            roofType: 'dome', addons: ['goods'], lit: false,
          }) });;
          placed.push({ x: bx, y: by, w: unit * 0.92, h: unit * 1.05 });
        } else if (sp.kind === 'temple') {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawStruct(bx, by, unit * 1.1, unit * 1.3, {
            race: s.race, wall: wallLit, roof: '#e8e2cc', roofDark: '#b8b09a',
            roofType: s.race === 2 ? 'flat' : 'spire',
            addons: [s.race === 3 ? 'horns' : 'cross'], lit: true,
          }) });;
          placed.push({ x: bx, y: by, w: unit * 1.1, h: unit * 1.3 });
        } else if (sp.kind === 'barracks') {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawStruct(bx, by, unit * 1.15, unit * 1.0, {
            race: s.race, wall: wallDim, roof: rfd, roofDark: shade(race.rgb, 0.42),
            roofType: s.race === 2 ? 'flat' : 'gable',
            addons: ['banner', 'shield', 'crenel'], lit: true,
          }) });;
          placed.push({ x: bx, y: by, w: unit * 1.15, h: unit * 1.0 });
        } else {
          if (rebuild) this._pending.push({ wy, draw: () => this.drawStruct(bx, by, unit * 0.7, unit * 1.55, {
            race: s.race, wall: wallLit, roof: roof, roofDark,
            roofType: 'flat', addons: ['banner'], lit: true,
          }) });;
          placed.push({ x: bx, y: by, w: unit * 0.7, h: unit * 1.55 });
        }
      }

      // 低倍视野不排序：建筑直接铺完再画人（老路径，快 12ms/帧）。
      // 只有拉近到能看清屋顶高度差时，才值得为「前后遮挡」付这份开销。
      if (this.cam.zoom < 24) {
        for (const p of this._pending) p.draw();
        this._pending.length = 0;
      }

      const houseCount = placed.length;
      const innerCount = 2;

      // ---- 城内地物：篝火 / 井 / 柴堆 / 摊位 / 栅栏 ----
      // 这些东西不参与模拟，但它们决定了画面「有没有人住」
      {
        const u = unit;
        // 篝火：城中一小堆火，火光暖黄
        if (s.tier >= 1) {
          const fx = Math.round(sx + u * 0.16);
          const fy = Math.round(sy + u * 0.1);
          ctx.fillStyle = '#3a3228';
          ctx.fillRect(fx - u * 0.22, fy, u * 0.44, u * 0.2);
          const fl = 0.7 + Math.sin(Date.now() / 180 + s.id) * 0.3;
          ctx.fillStyle = `rgba(246,45,20,${(fl * 0.9).toFixed(2)})`;
          ctx.fillRect(fx - u * 0.13, fy - u * 0.18, u * 0.26, u * 0.22);
          ctx.fillStyle = `rgba(255,200,80,${fl.toFixed(2)})`;
          ctx.fillRect(fx - u * 0.06, fy - u * 0.26, u * 0.13, u * 0.16);
        }
        // 井
        if (s.tier >= 2) {
          const wx = Math.round(sx - u * 0.5);
          const wy = Math.round(sy + u * 0.34);
          ctx.fillStyle = '#8e8e88';
          ctx.fillRect(wx - u * 0.14, wy - u * 0.1, u * 0.28, u * 0.2);
          ctx.fillStyle = '#2a3a44';
          ctx.fillRect(wx - u * 0.08, wy - u * 0.06, u * 0.16, u * 0.12);
          ctx.fillStyle = '#8a5a2b';
          ctx.fillRect(wx - u * 0.16, wy - u * 0.26, u * 0.04, u * 0.18);
          ctx.fillRect(wx + u * 0.12, wy - u * 0.26, u * 0.04, u * 0.18);
          ctx.fillRect(wx - u * 0.16, wy - u * 0.28, u * 0.32, u * 0.04);
        }
        // 柴堆
        const woodN = 1 + (s.id % 2);
        for (let k = 0; k < woodN; k++) {
          const wx = Math.round(sx + u * (0.55 + k * 0.3));
          const wy = Math.round(sy - u * (0.28 + (k % 2) * 0.2));
          ctx.fillStyle = '#8a5a2b';
          ctx.fillRect(wx, wy, u * 0.22, u * 0.07);
          ctx.fillRect(wx, wy + u * 0.09, u * 0.22, u * 0.07);
          ctx.fillStyle = '#6b4420';
          ctx.fillRect(wx + u * 0.08, wy - u * 0.06, u * 0.06, u * 0.06);
        }
        // 摊位（集市）
        if (s.tier >= 2) {
          const mx = Math.round(sx - u * 0.62);
          const my = Math.round(sy - u * 0.36);
          ctx.fillStyle = '#8a5a2b';
          ctx.fillRect(mx, my, u * 0.03, u * 0.16);
          ctx.fillRect(mx + u * 0.2, my, u * 0.03, u * 0.16);
          ctx.fillStyle = shade(race.rgb, 1.15);
          ctx.fillRect(mx - u * 0.02, my - u * 0.06, u * 0.28, u * 0.07);
        }
        // 栅栏（城边一圈短桩）
        if (s.tier <= 1) {
          const fr = spread * 1.18;
          ctx.fillStyle = '#7a5f42';
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2 + 0.2;
            const px = Math.round(sx + Math.cos(a) * fr);
            const py = Math.round(sy + Math.sin(a) * fr * 0.72);
            ctx.fillRect(px, py, 1, Math.max(1, Math.round(u * 0.1)));
          }
        }
      }

      // ---- 破损：愤怒的民众砸出来的洞（情绪可视化里最直观的一种）----
      const dmg = s.damage ?? 0;
      if (dmg > 0.12) {
        const hole = Math.max(2, Math.round(unit * 0.15));
        for (let k = 0; k < placed.length; k++) {
          if (h2(seed + 909, k) > dmg) continue;
          const b = placed[k];
          const bx = Math.round(b.x);
          const by = Math.round(b.y);
          ctx.fillStyle = 'rgba(16,11,7,0.86)';
          ctx.fillRect(bx - hole, by - hole, hole * 2, hole * 2);
          ctx.fillStyle = 'rgba(48,34,22,0.75)';
          ctx.fillRect(bx + hole, by - hole * 2, Math.max(1, Math.round(hole / 2)), hole * 3);
        }
      }

      // ---- 农田：城外一圈小麦色条纹地块 ----
      if (s.tier >= 1) {
        const farmCount = s.tier >= 3 ? 4 : s.tier >= 2 ? 3 : 2;
        for (let k = 0; k < farmCount; k++) {
          const a = (k / farmCount) * Math.PI * 2 + 0.7 + h2(s.id, k) * 0.4;
          const rr = unit * (2.15 + h2(s.id + 3, k) * 0.55);
          const fx = Math.round(sx + Math.cos(a) * rr);
          const fy = Math.round(sy + Math.sin(a) * rr * 0.68);
          const fw = Math.max(5, Math.round(unit * 0.62));
          const fh = Math.max(4, Math.round(unit * 0.46));
          // 田埂
          ctx.fillStyle = 'rgba(92,74,40,0.55)';
          ctx.fillRect(fx - fw / 2 - 1, fy - fh / 2 - 1, fw + 2, fh + 2);
          // 麦田底色
          ctx.fillStyle = k % 2 === 0 ? '#cbb855' : '#bfa947';
          ctx.fillRect(fx - fw / 2, fy - fh / 2, fw, fh);
          // 垄沟
          ctx.fillStyle = 'rgba(96,76,32,0.4)';
          const rows = Math.max(2, Math.round(fh / 2));
          for (let i = 0; i < rows; i++) {
            ctx.fillRect(fx - fw / 2, fy - fh / 2 + i * (fh / rows), fw, 1);
          }
        }
      }

      // ---- 塔楼：城镇以上，城角一座高塔 ----
      if (s.tier >= 2) {
        const ta = h2(s.id, 77) * Math.PI * 2;
        const tx = sx + Math.cos(ta) * unit * 1.05;
        const ty = sy + Math.sin(ta) * unit * 0.8;
        const tw = Math.max(3, unit * 0.26);
        const th = Math.max(6, unit * 0.95);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(tx + 2, ty - th * 0.2 + 2, tw, th * 0.9);
        ctx.fillStyle = '#9a917a';
        ctx.fillRect(tx, ty - th * 0.8, tw, th * 0.85);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(tx + tw * 0.62, ty - th * 0.8, tw * 0.38, th * 0.85);
        // 塔顶
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(tx + tw * 0.5, ty - th * 1.25);
        ctx.lineTo(tx + tw, ty - th * 0.8);
        ctx.lineTo(tx, ty - th * 0.8);
        ctx.closePath();
        ctx.fill();
      }

      // ---- 神庙：城市以上，一座带尖顶的大殿 ----
      if (s.tier >= 3) {
        const ga = h2(s.id, 91) * Math.PI * 2;
        const gx = sx + Math.cos(ga) * unit * 1.45;
        const gy = sy + Math.sin(ga) * unit * 0.95;
        const gw = Math.max(6, unit * 0.7);
        const gh = Math.max(6, unit * 0.62);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(gx - gw / 2 + 2, gy - gh / 2 + 2, gw, gh);
        ctx.fillStyle = '#e8ddc0';
        ctx.fillRect(gx - gw / 2, gy - gh / 2, gw, gh);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(gx + gw * 0.2, gy - gh / 2, gw * 0.3, gh);
        // 尖顶 + 十字
        ctx.fillStyle = '#b8a06a';
        ctx.beginPath();
        ctx.moveTo(gx, gy - gh * 1.35);
        ctx.lineTo(gx + gw * 0.42, gy - gh * 0.5);
        ctx.lineTo(gx - gw * 0.42, gy - gh * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff4cf';
        ctx.fillRect(gx - 1, gy - gh * 1.55, 2, Math.max(3, gh * 0.28));
        ctx.fillRect(gx - Math.max(2, gh * 0.14), gy - gh * 1.45, Math.max(4, gh * 0.28), 2);
      }

      // ---- 码头：紧邻水面的城市，向水里伸出一条栈桥 ----
      {
        let waterDir: [number, number] | null = null;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][]) {
          for (let d = 2; d <= 4; d++) {
            const nx = s.x + dx * d;
            const ny = s.y + dy * d;
            if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) break;
            const nt = world.terrain[ny * world.w + nx];
            if (nt === T.Water || nt === T.Deep) { waterDir = [dx, dy]; break; }
          }
          if (waterDir) break;
        }
        if (waterDir) {
          const [dx, dy] = waterDir;
          const px0 = sx + dx * unit * 1.1;
          const py0 = sy + dy * unit * 0.9;
          const len = unit * 1.6;
          ctx.strokeStyle = '#8a6f45';
          ctx.lineWidth = Math.max(2, unit * 0.22);
          ctx.beginPath();
          ctx.moveTo(px0, py0);
          ctx.lineTo(px0 + dx * len, py0 + dy * len * 0.7);
          ctx.stroke();
          // 小船
          const bx2 = px0 + dx * len;
          const by2 = py0 + dy * len * 0.7;
          ctx.fillStyle = '#6d5333';
          ctx.fillRect(bx2 - unit * 0.2, by2 - unit * 0.08, unit * 0.4, unit * 0.16);
        }
      }

      // 都城王宫
      if (s.capital && s.tier >= 2) {
        this.drawHouse(sx, sy - unit * 0.15, unit * 1.15, unit * 1.1, roof, roofDark, true, true, s.race);
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

      // 小人改由 drawUnits 统一绘制（真实个体，会走动）

      // 情绪图标：3 像素的脸画不出表情，情绪一律外化成头顶小图标
      if (z >= 5) {
        const mood = s.mood ?? 'normal';
        const st = s.status;
        // 只在「情绪刚发生变化」的那一小段时间显示图标。
        // 原来按 mood 常驻，结果每座城头顶都挂一个方块，画面全是 UI 噪音。
        void mood;
        const icon = st === 'sing' ? 'note'
          : st === 'laugh' ? 'laugh'
          : st === 'curse' ? 'hash'
          : st === 'cry' ? 'drop'
          : st === 'tantrum' ? 'rage'
          : st === 'love' ? 'heart'
          : null;
        if (icon) {
          const d = Math.max(6, Math.round(z * 0.8));
          drawMoodIcon(ctx, Math.round(sx), Math.round(sy - unit * 1.15), d, icon);
        }
      }

      // 人口数字：只在放得很大时出现，而且要「弱」——
      // 标签一旦喧宾夺主，画面就从世界变成了仪表盘
      if (z >= 40) {
        const label = String(Math.round(s.pop));
        ctx.font = `${Math.max(9, Math.round(z * 0.26))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const ty = sy - unit * 1.35;
        ctx.lineWidth = Math.max(2, z * 0.08);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(8,10,14,0.45)';
        ctx.strokeText(label, sx, ty);
        ctx.fillStyle = 'rgba(240,232,208,0.72)';
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
  /**
   * 一栋房子。四族各有一套建筑语言 —— 远看轮廓就能认出这是谁的城：
   *   人类：木架 + 三角瓦顶        精灵：长在树上的圆形树屋
   *   矮人：石墙 + 平顶 + 烟囱      兽人：兽皮圆棚 + 兽角
   */
  /**
   * 通用建筑骨架。所有建筑 = 墙体 + 屋顶 + 附件。
   * 屋顶形状与附件决定它是什么建筑，配色决定它属于哪个种族。
   */
  private drawStruct(
    bx: number, by: number, hw: number, hh: number,
    o: {
      race: number;
      wall: string;
      roof: string;
      roofDark: string;
      roofType: 'gable' | 'flat' | 'dome' | 'spire' | 'tree';
      addon?: 'chimney' | 'banner' | 'cross' | 'horns' | 'goods' | 'shield' | 'belfry';
      addons?: string[];
      lit?: boolean;
    },
  ): void {
    paintStruct(this.ctx, bx, by, hw, hh, o);
  }

  /** 民居（保留旧接口，内部转到 drawStruct） */
  private drawHouse(
    bx: number, by: number, hw: number, hh: number,
    roof: string, roofDark: string, lightWall: boolean, lightRoof: boolean,
    race = 0,
  ): void {
    void lightRoof;
    const wallOf = ['#f4ecd6', '#e6dcc0', '#9a9a94', '#7a5f42'][race] ?? '#f4ecd6';
    const roofType: 'gable' | 'flat' | 'dome' | 'tree' =
      race === 1 ? 'tree' : race === 2 ? 'flat' : race === 3 ? 'dome' : 'gable';
    this.drawStruct(bx, by, hw, hh, {
      race,
      wall: lightWall ? wallOf : shade(hexToRgb(wallOf), 0.9),
      roof,
      roofDark,
      roofType,
      addons: race === 2 ? ['chimney'] : [],
      lit: Math.random() < 0.35,
    });
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

/**
 * 头顶情绪图标。俯瞰尺度下这是唯一可行的情绪表达方式：
 * 符号用 2~4 个像素块拼，配深色底衬保证在任何地形上都能看清。
 */
function drawMoodIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  kind: 'note' | 'laugh' | 'hash' | 'drop' | 'rage' | 'heart',
): void {
  const px = Math.max(1, Math.round(size / 4));
  const half = Math.round((px * 4) / 2);

  // 深色底衬
  ctx.fillStyle = 'rgba(6,6,4,0.6)';
  ctx.fillRect(cx - half - px, cy - half - px, px * 6, px * 6);

  const X = (i: number) => cx - half + i * px;
  const Y = (j: number) => cy - half + j * px;

  if (kind === 'note') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(X(2), Y(0), px, px * 3);
    ctx.fillRect(X(1), Y(0), px * 2, px);
    ctx.fillRect(X(0), Y(1), px, px);
  } else if (kind === 'laugh') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(X(1), Y(0), px * 2, px);
    ctx.fillRect(X(0), Y(1), px, px * 2);
    ctx.fillRect(X(3), Y(1), px, px * 2);
    ctx.fillRect(X(1), Y(3), px * 2, px);
    ctx.fillStyle = '#2a1a0c';
    ctx.fillRect(X(1), Y(2), px, px);
    ctx.fillRect(X(2), Y(2), px, px);
  } else if (kind === 'hash') {
    ctx.fillStyle = '#ff3b2a';
    ctx.fillRect(X(1), Y(0), px, px * 4);
    ctx.fillRect(X(2), Y(0), px, px * 4);
    ctx.fillRect(X(0), Y(1), px * 4, px);
    ctx.fillRect(X(0), Y(2), px * 4, px);
  } else if (kind === 'drop') {
    ctx.fillStyle = '#55aef0';
    ctx.fillRect(X(1), Y(0), px * 2, px);
    ctx.fillRect(X(1), Y(1), px * 2, px * 2);
    ctx.fillRect(X(0), Y(2), px * 4, px);
    ctx.fillRect(X(1), Y(3), px * 2, px);
    ctx.fillStyle = '#cfeeff';
    ctx.fillRect(X(1), Y(1), px, px);
  } else if (kind === 'rage') {
    ctx.fillStyle = '#ff3b2a';
    ctx.fillRect(X(0), Y(0), px * 2, px);
    ctx.fillRect(X(2), Y(1), px * 2, px);
    ctx.fillRect(X(0), Y(2), px * 2, px);
    ctx.fillRect(X(2), Y(3), px * 2, px);
    ctx.fillRect(X(1), Y(1), px, px * 2);
  } else {
    ctx.fillStyle = '#ff6fae';
    ctx.fillRect(X(0), Y(0), px * 2, px);
    ctx.fillRect(X(2), Y(0), px * 2, px);
    ctx.fillRect(X(0), Y(1), px * 4, px * 2);
    ctx.fillRect(X(1), Y(3), px * 2, px);
  }
}

/** #rrggbb → [r,g,b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 四族外观（图鉴脚本也用它） */

/**
 * 画一个单位。所有细节都按身高分级 —— 小人矮的时候自动省略，
 * 放大到 12px 以上才出现眼睛、腰带、靴子。
 *
 * 这个函数被游戏渲染和图鉴脚本共用，避免「测试图好看、游戏里不一样」。
 */
export function paintStruct(
  ctx: CanvasRenderingContext2D,
    bx: number, by: number, hw: number, hh: number,
    o: {
      race: number;
      wall: string;
      roof: string;
      roofDark: string;
      roofType: 'gable' | 'flat' | 'dome' | 'spire' | 'tree';
      addon?: 'chimney' | 'banner' | 'cross' | 'horns' | 'goods' | 'shield' | 'belfry';
      addons?: string[];
      lit?: boolean;
    },
  ): void {
    const bw = Math.max(6, Math.round(hw));
    const bh = Math.max(6, Math.round(hh));
    const x0 = Math.round(bx - bw / 2);
    const y0 = Math.round(by - bh / 2);
    const eave = y0 + Math.round(bh * 0.48);
    const wallH = Math.max(2, y0 + bh - eave);
    const ridge = y0 + Math.round(bh * 0.04);

    // 落地影：光源固定在左上，所以影子一律落在右下。
    // 阴影方向统一，是「同一个世界」和「一堆贴图」的分界线
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(x0 + 3, y0 + bh, bw, Math.max(2, Math.round(bh * 0.1)));
    ctx.fillRect(x0 + bw, y0 + Math.max(1, Math.round(bh * 0.2)), 2, Math.round(bh * 0.78));

    if (o.roofType === 'tree') {
      // ---------- 精灵：树屋 ----------
      const tw = Math.max(2, Math.round(bw * 0.24));
      ctx.fillStyle = '#4a3524';
      ctx.fillRect(x0 + Math.round((bw - tw) / 2), eave, tw, wallH);
      ctx.fillStyle = '#63472f';
      ctx.fillRect(x0 + Math.round((bw - tw) / 2), eave, Math.max(1, Math.round(tw * 0.5)), wallH);
      // 木平台
      const plankY = eave + Math.round(wallH * 0.26);
      ctx.fillStyle = '#c9a46a';
      ctx.fillRect(x0 - 1, plankY, bw + 2, Math.max(1, Math.round(bh * 0.1)));
      ctx.fillStyle = 'rgba(60,40,20,0.5)';
      ctx.fillRect(x0 - 1, plankY + Math.max(1, Math.round(bh * 0.1)) - 1, bw + 2, 1);
      // 门洞
      ctx.fillStyle = 'rgba(28,18,10,0.85)';
      ctx.fillRect(x0 + Math.round(bw * 0.4), eave + Math.round(wallH * 0.55), Math.max(2, Math.round(bw * 0.2)), Math.max(2, wallH * 0.45));
      // 树冠
      const cy = eave - Math.round(bh * 0.22);
      const cr = Math.max(4, Math.round(bw * 0.7));
      ctx.fillStyle = '#123d12';
      ctx.beginPath(); ctx.ellipse(bx, cy, cr + 1, cr * 0.86 + 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fc356';
      ctx.beginPath(); ctx.ellipse(bx, cy, cr, cr * 0.82, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8fd96f';
      ctx.beginPath(); ctx.ellipse(bx - cr * 0.24, cy - cr * 0.22, cr * 0.68, cr * 0.58, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b6e88f';
      ctx.beginPath(); ctx.ellipse(bx - cr * 0.32, cy - cr * 0.4, cr * 0.36, cr * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,226,140,0.95)';
      ctx.fillRect(Math.round(bx) - 1, cy, 2, 2);

      // —— 以下是把「一个球」变成「一栋树屋」的几笔 ——
      // 门洞边框：深色洞 + 一圈木头
      const dw2 = Math.max(2, Math.round(bw * 0.2));
      const dh2 = Math.max(2, wallH * 0.45);
      const dx2 = x0 + Math.round(bw * 0.4);
      const dy2 = eave + Math.round(wallH * 0.55);
      ctx.fillStyle = '#7a5a34';
      ctx.fillRect(dx2 - 1, dy2 - 1, dw2 + 2, dh2 + 1);
      ctx.fillStyle = 'rgba(24,14,8,0.92)';
      ctx.fillRect(dx2, dy2, dw2, dh2);
      // 木梯：三级错位踏板，从地面通到平台
      ctx.fillStyle = '#b98f52';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(dx2 - 2 + i, eave + Math.round(wallH * (0.95 - i * 0.16)), Math.max(2, Math.round(bw * 0.16)), 1);
      }
      // 树枝：左右各伸出一截，让树不像悬空的球
      ctx.fillStyle = '#5c4226';
      ctx.fillRect(x0 - Math.max(2, Math.round(bw * 0.14)), plankY + 1, Math.max(2, Math.round(bw * 0.16)), 1);
      ctx.fillRect(x0 + bw - Math.round(bw * 0.02), plankY + 2, Math.max(2, Math.round(bw * 0.14)), 1);
      // 冠内的叶簇暗部：三个深绿色斑，树冠才有体积
      ctx.fillStyle = 'rgba(18,52,20,0.55)';
      ctx.beginPath(); ctx.ellipse(bx + cr * 0.34, cy + cr * 0.3, cr * 0.34, cr * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx - cr * 0.5, cy + cr * 0.1, cr * 0.22, cr * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      // 挂在平台边的小灯
      if (bw >= 10) {
        ctx.fillStyle = '#ffe27a';
        ctx.fillRect(x0 + 1, plankY - 2, 1, 1);
        ctx.fillStyle = 'rgba(255,240,180,0.35)';
        ctx.fillRect(x0, plankY - 3, 3, 3);
      }
      return;
    }

    // ---------- 墙体 ----------
    ctx.fillStyle = o.wall;
    ctx.fillRect(x0, eave, bw, wallH);
    // 右墙背光
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fillRect(x0 + Math.round(bw * 0.64), eave, Math.round(bw * 0.36), wallH);
    // 左上受光边：所有建筑共用同一个光源方向，
    // 这是「一个世界」和「一堆贴图拼起来」的分界线
    ctx.fillStyle = 'rgba(255,250,232,0.55)';
    ctx.fillRect(x0, eave, 1, wallH);
    ctx.fillRect(x0, y0 + 1, Math.max(1, Math.round(bw * 0.45)), 1);
    // 材质纹理
    if (o.race === 2) {
      // 矮人：石缝（错缝砌法，横缝 1px + 每层竖缝错开）
      ctx.fillStyle = 'rgba(44,42,40,0.34)';
      const rows = Math.max(2, Math.round(wallH / 4));
      for (let r = 1; r < rows; r++) {
        const ry = eave + Math.round((wallH * r) / rows);
        ctx.fillRect(x0, ry, bw, 1);
        // 竖缝：每层错半块
        const off = (r % 2) * 0.5;
        ctx.fillRect(x0 + Math.round(bw * (0.3 + off)), ry - 3, 1, 3);
        if (bw > 12) ctx.fillRect(x0 + Math.round(bw * (0.7 - off)), ry - 3, 1, 3);
      }
    } else if (o.race === 0) {
      // 人类：半木结构（白墙 + 木骨架），梁要 1px 但要有横有竖有斜撑
      ctx.fillStyle = 'rgba(96,62,34,0.82)';
      ctx.fillRect(x0, eave, bw, 2);                 // 上梁
      ctx.fillRect(x0, y0 + bh - 2, bw, 2);          // 勒脚
      ctx.fillRect(x0, eave, 1, wallH);              // 左柱
      ctx.fillRect(x0 + bw - 1, eave, 1, wallH);     // 右柱
      if (bw >= 9) {
        ctx.fillRect(x0 + Math.round(bw * 0.5), eave, 1, wallH); // 中柱
        ctx.fillRect(x0 + Math.round(bw * 0.5), eave, 1, 2);
        // 斜撑：两段错位模拟 45°
        const qy = eave + Math.round(wallH * 0.34);
        ctx.fillRect(x0 + 2, qy, 2, 1);
        ctx.fillRect(x0 + 4, qy - 1, 2, 1);
        ctx.fillRect(x0 + bw - 4, qy, 2, 1);
        ctx.fillRect(x0 + bw - 6, qy - 1, 2, 1);
      }
    } else if (o.race === 3) {
      // 兽人：兽皮竖缝（2px 一条，缝间留亮筋）
      ctx.fillStyle = 'rgba(34,22,14,0.4)';
      const cols = Math.max(2, Math.round(bw / 5));
      for (let r = 1; r < cols; r++) ctx.fillRect(x0 + Math.round((bw * r) / cols), eave, 1, wallH);
      ctx.fillStyle = 'rgba(255,240,210,0.18)';
      for (let r = 1; r < cols; r++) ctx.fillRect(x0 + Math.round((bw * r) / cols) + 1, eave, 1, wallH);
    }
    // 门
    ctx.fillStyle = 'rgba(38,28,18,0.86)';
    ctx.fillRect(x0 + Math.round(bw * 0.42), eave + Math.round(wallH * 0.36), Math.max(2, Math.round(bw * 0.2)), Math.max(2, wallH * 0.64));
    // 门框：两侧各 1px 亮边 + 头顶一道过梁，门才像「嵌在墙里」而不是贴了块黑
    if (bw >= 8) {
      const dx0 = x0 + Math.round(bw * 0.42);
      const dy0 = eave + Math.round(wallH * 0.36);
      const dw0 = Math.max(2, Math.round(bw * 0.2));
      const dh0 = Math.max(2, wallH * 0.64);
      ctx.fillStyle = 'rgba(236,228,208,0.45)';
      ctx.fillRect(dx0 - 1, dy0, 1, dh0);
      ctx.fillRect(dx0, dy0 - 1, dw0, 1);
      ctx.fillStyle = 'rgba(255,232,170,0.5)';
      ctx.fillRect(dx0 + Math.round(dw0 * 0.5), dy0 + Math.round(dh0 * 0.55), 1, 1); // 门环
    }

    // 门前石阶：两级。人走到门口时脚下有落点，人屋关系才不会「浮」
    if (bw >= 8) {
      const sx0 = x0 + Math.round(bw * 0.38);
      const sw0 = Math.max(3, Math.round(bw * 0.3));
      ctx.fillStyle = 'rgba(202,196,182,0.9)';
      ctx.fillRect(sx0, y0 + bh, sw0, 1);
      ctx.fillStyle = 'rgba(130,124,112,0.85)';
      ctx.fillRect(sx0 - 1, y0 + bh + 1, sw0 + 2, 1);
    }

    // 窗（亮灯）
    if (bw >= 9) {
      const wx = x0 + Math.round(bw * 0.13);
      const wy = eave + Math.round(wallH * 0.22);
      const ww = Math.max(1, Math.round(bw * 0.15));
      const wh = Math.max(1, Math.round(wallH * 0.3));
      ctx.fillStyle = o.lit ? 'rgba(255,214,120,0.92)' : 'rgba(52,42,28,0.72)';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillRect(x0 + Math.round(bw * 0.72), wy, ww, wh);
      // 窗框 + 窗台：不加这两笔，窗户就是墙上两块亮斑
      ctx.fillStyle = 'rgba(46,36,24,0.7)';
      ctx.fillRect(wx - 1, wy - 1, ww + 2, 1);
      ctx.fillRect(wx - 1, wy, 1, wh);
      ctx.fillRect(wx + ww, wy, 1, wh);
      ctx.fillRect(x0 + Math.round(bw * 0.72) - 1, wy - 1, ww + 2, 1);
      ctx.fillRect(x0 + Math.round(bw * 0.72) - 1, wy, 1, wh);
      ctx.fillStyle = 'rgba(230,222,202,0.4)';
      ctx.fillRect(wx - 1, wy + wh, ww + 2, 1);
      ctx.fillRect(x0 + Math.round(bw * 0.72) - 1, wy + wh, ww + 2, 1);
    }

    // ---------- 屋顶 ----------
    if (o.roofType === 'gable') {
      ctx.fillStyle = o.roofDark;
      ctx.beginPath();
      ctx.moveTo(x0 + bw * 0.5, ridge);
      ctx.lineTo(x0 + bw + 1, eave);
      ctx.lineTo(x0 - 1, eave);
      ctx.closePath();
      ctx.fill();
      // 左坡受光
      ctx.fillStyle = o.roof;
      ctx.beginPath();
      ctx.moveTo(x0 + bw * 0.5, ridge);
      ctx.lineTo(x0 + bw * 0.5, eave);
      ctx.lineTo(x0 - 1, eave);
      ctx.closePath();
      ctx.fill();
      // 瓦垄
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let i = 1; i < 3; i++) {
        ctx.fillRect(x0 + Math.round((bw * i) / 3), ridge + ((eave - ridge) * i) / 3, Math.max(1, Math.round(bw / 4)), 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fillRect(x0 + Math.round(bw * 0.44), ridge, Math.max(1, Math.round(bw * 0.14)), 1);
    } else if (o.roofType === 'flat') {
      ctx.fillStyle = o.roofDark;
      ctx.fillRect(x0 - 1, ridge, bw + 2, eave - ridge);
      ctx.fillStyle = o.roof;
      ctx.fillRect(x0 - 1, ridge, bw + 2, Math.max(1, Math.round((eave - ridge) * 0.45)));
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x0 - 1, ridge, bw + 2, 1);
    } else if (o.roofType === 'dome') {
      const cy = eave;
      const cr = Math.round(bw * 0.62);
      ctx.fillStyle = o.roofDark;
      ctx.beginPath(); ctx.ellipse(bx, cy, cr, cr * 0.92, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.roof;
      ctx.beginPath(); ctx.ellipse(bx - cr * 0.2, cy - cr * 0.1, cr * 0.66, cr * 0.6, 0, Math.PI, Math.PI * 2); ctx.fill();
    } else {
      // spire：尖顶（神庙）
      const sh = Math.round(bh * 0.85);
      ctx.fillStyle = o.roofDark;
      ctx.beginPath();
      ctx.moveTo(bx, eave - sh);
      ctx.lineTo(x0 + bw + 1, eave);
      ctx.lineTo(x0 - 1, eave);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = o.roof;
      ctx.beginPath();
      ctx.moveTo(bx, eave - sh);
      ctx.lineTo(bx, eave);
      ctx.lineTo(x0 - 1, eave);
      ctx.closePath();
      ctx.fill();
    }
    // 屋脊高光 + 缺瓦：屋顶是一片纯色最容易「假」，加两笔就有质感
    if (o.roofType === 'gable' || o.roofType === 'flat') {
      ctx.fillStyle = 'rgba(255,246,224,0.4)';
      ctx.fillRect(x0 + Math.round(bw * 0.18), y0 + Math.round(bh * 0.05), Math.round(bw * 0.64), 1);
      const sd2 = Math.round(bx * 11 + by * 7);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let i = 0; i < 2; i++) {
        const px2 = x0 + 2 + ((sd2 + i * 37) % Math.max(1, bw - 4));
        const py2 = y0 + 2 + ((sd2 + i * 53) % Math.max(1, Math.round(bh * 0.4)));
        ctx.fillRect(px2, py2, 1 + (i % 2), 1);
      }
    }

    // 屋檐暗线
    if (o.roofType !== 'dome' && o.roofType !== 'spire') {
      ctx.fillStyle = 'rgba(14,10,6,0.5)';
      ctx.fillRect(x0 - 1, eave, bw + 2, 1);
    }

    // ---------- 附件（可多个）----------
    // 同族的民居/工坊/兵营如果只靠单附件区分，缩放下会糊成一类，
    // 所以这里支持组合：工坊 = 烟囱 + 货箱，兵营 = 旗帜 + 盾 + 屋顶垛口
    const cx = Math.round(bx);
    const addons: string[] = (o as { addons?: string[] }).addons ?? (o.addon ? [o.addon] : []);
    for (const ad of addons) {
    if (ad === 'chimney') {
      ctx.fillStyle = '#6a6a66';
      ctx.fillRect(x0 + Math.round(bw * 0.7), ridge - Math.round(bh * 0.2), Math.max(2, Math.round(bw * 0.14)), Math.round(bh * 0.26));
      ctx.fillStyle = 'rgba(220,220,220,0.34)';
      ctx.fillRect(x0 + Math.round(bw * 0.7) + 1, ridge - Math.round(bh * 0.3), Math.max(1, Math.round(bw * 0.1)), Math.round(bh * 0.12));
    } else if (ad === 'banner') {
      // 旗杆 + 旗帜（用种族色）
      const px = x0 + bw - 2;
      ctx.fillStyle = '#6a5a44';
      ctx.fillRect(px, ridge - Math.round(bh * 0.55), 1, Math.round(bh * 0.6));
      const flag = shade([200, 80, 60], 1);
      ctx.fillStyle = o.roof;
      void flag;
      ctx.fillRect(px + 1, ridge - Math.round(bh * 0.55), Math.max(2, Math.round(bw * 0.22)), Math.max(2, Math.round(bh * 0.18)));
    } else if (ad === 'cross') {
      const py = ridge - Math.round(bh * 0.3);
      ctx.fillStyle = '#ffd447';
      ctx.fillRect(cx, py, 1, Math.max(2, Math.round(bh * 0.3)));
      ctx.fillRect(cx - 1, py + 1, 3, 1);
    } else if (ad === 'horns') {
      ctx.fillStyle = '#efe7d2';
      ctx.fillRect(x0 + Math.round(bw * 0.3), ridge - 2, 1, 2);
      ctx.fillRect(x0 + Math.round(bw * 0.66), ridge - 2, 1, 2);
    } else if (ad === 'goods') {
      // 门口堆放的货物（木箱 / 麻袋）
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(x0 + bw, eave + wallH - 2, 2, 2);
      ctx.fillStyle = '#b8a878';
      ctx.fillRect(x0 + bw, eave + wallH - 4, 2, 2);
    } else if (ad === 'crenel') {
      // 屋顶垛口：军事建筑的剪影特征
      ctx.fillStyle = o.roofDark;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const mx2 = Math.round(x0 + (bw * (i + 0.5)) / n - 1);
        ctx.fillRect(mx2, ridge - 1, 2, 2);
      }
    } else if (ad === 'shield') {
      // 门口挂的盾
      ctx.fillStyle = '#9aa4b2';
      ctx.fillRect(x0 - 2, eave + Math.round(wallH * 0.3), 2, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x0 - 2, eave + Math.round(wallH * 0.3), 1, 1);
    } else if (ad === 'belfry') {
      // 钟楼小亭
      ctx.fillStyle = o.roofDark;
      ctx.fillRect(cx - 2, ridge - 3, 4, 3);
      ctx.fillStyle = '#c9a94a';
      ctx.fillRect(cx - 1, ridge - 2, 2, 1);
    }
    }
  }
