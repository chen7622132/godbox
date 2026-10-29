import { T, IS_LAND, type World } from '../core/types';
import { RACES } from '../core/races';

/** 地形基础色 [r,g,b] —— 高饱和、强对比，方便一眼分辨 */
const PALETTE: [number, number, number][] = [
  [16, 40, 72],    // 0 Deep 深海
  [36, 96, 148],   // 1 Water 浅海
  [222, 202, 146], // 2 Sand 沙滩
  [96, 158, 72],   // 3 Grass 草原
  [42, 96, 56],    // 4 Forest 森林
  [148, 154, 100], // 5 Hill 丘陵
  [134, 128, 118], // 6 Mountain 山地
  [214, 226, 235], // 7 Snow 雪原
  [72, 86, 62],    // 8 Swamp 沼泽
  [108, 100, 90],  // 9 Ruin 废墟
];

const FIRE_RGB: [number, number, number] = [252, 140, 44];
const FIRE_HOT_RGB: [number, number, number] = [255, 240, 170];
const PLAGUE_RGB: [number, number, number] = [146, 62, 154];

/**
 * 缩放档位。必须是「每格细节像素数」的整数倍，否则像素会被非整数比例拉伸而发糊。
 * 4/8/16/24/32 用 8×8 细节，12/20 用 4×4 细节，1-3 用 1 像素。
 */
const ZOOM_STEPS = [1, 2, 3, 4, 8, 12, 16, 20, 24, 32];
const ZOOM_MAX = 32;

/** 8×8 的地块图案：. 正常 / o 亮 / O 最亮 / x 暗 / s 深色（树干） */
const PATTERN: Record<number, string[]> = {
  [T.Grass]: [
    '........',
    '..o....o',
    '.....o..',
    '.o......',
    '....o...',
    '..o...o.',
    '.......x',
    '...o....',
  ],
  [T.Forest]: [
    '...xx...',
    '..oooo..',
    '.ooOOoo.',
    '.oOOOOo.',
    '.ooOOoo.',
    '..oooo..',
    '...ss...',
    '...ss...',
  ],
  [T.Water]: [
    '........',
    '.oo..oo.',
    '........',
    '..oo..oo',
    '........',
    'oo..oo..',
    '........',
    '..oo..oo',
  ],
  [T.Deep]: [
    '........',
    '........',
    '...x....',
    '........',
    '.......o',
    '........',
    '..x.....',
    '........',
  ],
  [T.Sand]: [
    '........',
    '..o.....',
    '.....o..',
    '........',
    '.o....x.',
    '........',
    '...o....',
    '.......o',
  ],
  [T.Hill]: [
    '..oooo..',
    '.ooOOoo.',
    '.oOOOOo.',
    '.ooOOoo.',
    '..oooo..',
    '........',
    '..x..x..',
    '........',
  ],
  [T.Mountain]: [
    '...OO...',
    '..OOO...',
    '..OOo...',
    '.OOoo...',
    '.Oooo.x.',
    'OOoooo..',
    'Oooooo..',
    'ooooooox',
  ],
  [T.Snow]: [
    '........',
    '.....o..',
    '..o.....',
    '........',
    '.......o',
    '.o......',
    '........',
    '..o.....',
  ],
  [T.Swamp]: [
    '........',
    '..xx....',
    '.xxo....',
    '..xx....',
    '.....xx.',
    '....xxo.',
    '........',
    '...o....',
  ],
  [T.Ruin]: [
    '..x..x..',
    '.x..x...',
    '........',
    'x..xx..x',
    '........',
    '..x..x..',
    '.x......',
    '.....x..',
  ],
};

const SHADE_OF: Record<string, number> = {
  '.': 1.0,
  o: 1.2,
  O: 1.36,
  x: 0.76,
  s: 0.46,
};

/** 确定性噪声：同一坐标永远同一个值，不会逐帧闪烁 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  private dpr = 1;
  /** 离屏画布里一格占多少像素：1 / 4 / 8 */
  private tile = 1;
  private painted: Region = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** 相机动过就需要重画可见区域 */
  private camDirty = true;
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

  /** 按当前缩放决定离屏画布的细节密度，并重建缓冲 */
  private allocate(world: World): void {
    const t = pickTile(this.cam.zoom);
    const W = world.w * t;
    const H = world.h * t;
    this.tile = t;
    this.off.width = W;
    this.off.height = H;
    this.img = this.offCtx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
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

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.x -= dxScreen / this.cam.zoom;
    this.cam.y -= dyScreen / this.cam.zoom;
    this.camDirty = true;
  }

  clampCam(world: World): void {
    const halfW = this.cssW / 2 / this.cam.zoom;
    const halfH = this.cssH / 2 / this.cam.zoom;
    const nx = world.w * this.cam.zoom <= this.cssW
      ? world.w / 2
      : Math.max(halfW * 0.4, Math.min(world.w - halfW * 0.4, this.cam.x));
    const ny = world.h * this.cam.zoom <= this.cssH
      ? world.h / 2
      : Math.max(halfH * 0.4, Math.min(world.h - halfH * 0.4, this.cam.y));
    if (nx !== this.cam.x || ny !== this.cam.y) {
      this.cam.x = nx;
      this.cam.y = ny;
      this.camDirty = true;
    }
  }

  /** 按档位缩放。factor 只用来判断方向（>1 放大，<1 缩小） */
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

  /** 供 UI 显示当前倍率 */
  get zoomLabel(): string {
    return `${this.cam.zoom}x`;
  }

  // ==================== 渲染主流程 ====================

  render(world: World): void {
    const wantTile = pickTile(this.cam.zoom);
    if (wantTile !== this.tile || this.off.width !== world.w * wantTile) {
      this.allocate(world);
    }

    const [vx, vy] = this.viewOrigin();
    const vw = Math.ceil(this.cssW / this.cam.zoom) + 2;
    const vh = Math.ceil(this.cssH / this.cam.zoom) + 2;
    const region: Region = {
      x0: Math.max(0, vx - 1),
      y0: Math.max(0, vy - 1),
      x1: Math.min(world.w, vx + vw),
      y1: Math.min(world.h, vy + vh),
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

  /** 同一国家的城市之间画土路，让文明看起来是"连起来的" */
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

    // 先铺深色路基，再压浅色路面，两层叠起来才看得清
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(56,44,26,0.55)';
    ctx.lineWidth = Math.max(3, z * 0.38);
    for (const [[ax, ay], [bx, by]] of segs) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(219,196,146,0.9)';
    ctx.lineWidth = Math.max(1.4, z * 0.18);
    for (const [[ax, ay], [bx, by]] of segs) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // ==================== 地形层（只画可见区域） ====================

  private paintRegion(world: World, r: Region): void {
    const { w, h, terrain, fert, owner, nationOf, fire, plague } = world;
    const buf = this.buf;
    const T2 = this.tile;
    const W = world.w * T2;
    const tint = this.buildTint(world);
    const patStep = T2 === 8 ? 1 : 2;

    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * w + x;
        const t = terrain[i];
        const pal = PALETTE[t] ?? PALETTE[0];
        const f = fert[i];

        let br = pal[0];
        let bg = pal[1];
        let bb = pal[2];

        // 肥力决定明暗
        if (IS_LAND[t] && t !== T.Snow) {
          const v = 0.82 + (f / 255) * 0.34;
          br *= v; bg *= v; bb *= v;
        }

        // 领土叠色
        const oid = owner[i];
        if (oid >= 0) {
          const tc = tint.get(oid);
          if (tc) {
            br = br * 0.45 + tc[0] * 0.55;
            bg = bg * 0.45 + tc[1] * 0.55;
            bb = bb * 0.45 + tc[2] * 0.55;
          }
        }

        // 国界压暗
        if (oid >= 0) {
          const nid = nationOf[i];
          const rn = x + 1 < w ? nationOf[i + 1] : -1;
          const dn = y + 1 < h ? nationOf[i + w] : -1;
          const ro = x + 1 < w ? owner[i + 1] : -1;
          const dow = y + 1 < h ? owner[i + w] : -1;
          if (nid !== rn || nid !== dn) {
            br *= 0.22; bg *= 0.22; bb *= 0.22;
          } else if (ro !== oid || dow !== oid) {
            br *= 0.72; bg *= 0.72; bb *= 0.72;
          }
        }

        // 近岸浅水
        if (!IS_LAND[t]) {
          let nearLand = 0;
          if (y > 0 && IS_LAND[terrain[i - w]]) nearLand++;
          if (y + 1 < h && IS_LAND[terrain[i + w]]) nearLand++;
          if (x > 0 && IS_LAND[terrain[i - 1]]) nearLand++;
          if (x + 1 < w && IS_LAND[terrain[i + 1]]) nearLand++;
          if (nearLand > 0) {
            const k = Math.min(0.34, nearLand * 0.1);
            br = br * (1 - k) + 120 * k;
            bg = bg * (1 - k) + 168 * k;
            bb = bb * (1 - k) + 178 * k;
          }
        }

        const fv = fire[i];
        const pv = plague[i];
        const fk = fv > 0 ? Math.min(1, fv / 150) : 0;
        const pk = pv > 0 ? Math.min(0.72, pv / 220) : 0;

        const above = y > 0 ? terrain[i - w] : t;
        const surf = !IS_LAND[t] && IS_LAND[above] ? 1.35 : 1;
        const below = y + 1 < h ? terrain[i + w] : T.Deep;
        const cliff = IS_LAND[t] && !IS_LAND[below] ? 0.84 : 1;

        const pat = PATTERN[t];
        const ox = x * T2;
        const oy = y * T2;

        for (let py = 0; py < T2; py++) {
          const rowBase = (oy + py) * W + ox;
          const patRow = pat ? pat[Math.min(7, Math.floor(py / patStep))] : undefined;
          for (let px = 0; px < T2; px++) {
            let shade: number;
            if (patRow) {
              const ch = patRow[Math.min(7, Math.floor(px / patStep))] ?? '.';
              const base = SHADE_OF[ch] ?? 1;
              shade = ch === '.' ? base * (0.96 + hash2(x * 3 + px, y * 5 + py) * 0.08) : base;
            } else {
              shade = 0.96 + hash2(x * 3 + px, y * 5 + py) * 0.08;
            }
            if (py === T2 - 1) shade *= 0.92;
            shade *= cliff;
            if (surf > 1 && py === 0) shade *= surf;

            let cr = br * shade;
            let cg = bg * shade;
            let cb = bb * shade;

            if (fk > 0) {
              cr = cr * (1 - fk) + (FIRE_HOT_RGB[0] * 0.45 + FIRE_RGB[0] * 0.55) * fk;
              cg = cg * (1 - fk) + (FIRE_HOT_RGB[1] * 0.45 + FIRE_RGB[1] * 0.55) * fk;
              cb = cb * (1 - fk) + (FIRE_HOT_RGB[2] * 0.35 + FIRE_RGB[2] * 0.35) * fk;
            }
            if (pk > 0) {
              cr = cr * (1 - pk) + PLAGUE_RGB[0] * pk;
              cg = cg * (1 - pk) + PLAGUE_RGB[1] * pk;
              cb = cb * (1 - pk) + PLAGUE_RGB[2] * pk;
            }

            buf[rowBase + px] = pack(cr, cg, cb);
          }
        }
      }
    }
  }

  // ==================== 建筑层 + 人口层 ====================

  private drawSettlements(world: World): void {
    const { ctx } = this;
    const z = this.cam.zoom;

    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      const [sx, sy] = this.worldToScreen(s.x + 0.5, s.y + 0.5);
      if (sx < -80 || sy < -80 || sx > this.cssW + 80 || sy > this.cssH + 80) continue;

      const race = RACES[s.race];
      const unit = z;

      if (z < 3) {
        const size = Math.max(2, Math.round(unit * 0.55));
        ctx.fillStyle = race.color;
        ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
        if (s.capital) {
          ctx.fillStyle = '#fff3c4';
          ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, Math.max(1, size / 3));
        }
        continue;
      }

      // 落地阴影
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + unit * 0.42, unit * 0.62, unit * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // 城墙：画成中空的围墙，能看见城里
      if (s.walls > 0) {
        const half = unit * 2.05;
        const thick = Math.max(2, unit * 0.2);
        ctx.fillStyle = 'rgba(20,16,10,0.5)';
        ctx.fillRect(sx - half - 1, sy - half - 1, half * 2 + 2, thick + 2);
        ctx.fillStyle = '#6f6752';
        // 上
        ctx.fillRect(sx - half, sy - half, half * 2, thick);
        // 下
        ctx.fillRect(sx - half, sy + half - thick, half * 2, thick);
        // 左
        ctx.fillRect(sx - half, sy - half, thick, half * 2);
        // 右
        ctx.fillRect(sx + half - thick, sy - half, thick, half * 2);
        // 垛口
        ctx.fillStyle = '#837a62';
        for (let t = 0; t < 4; t++) {
          const tx = sx - half + (half * 2 * (t + 0.5)) / 4 - thick * 0.3;
          ctx.fillRect(tx, sy - half, thick * 0.6, thick * 0.5);
          ctx.fillRect(tx, sy + half - thick * 0.5, thick * 0.6, thick * 0.5);
        }
        // 城门缺口
        const gate = Math.max(3, unit * 0.36);
        ctx.fillStyle = '#3a3428';
        ctx.fillRect(sx - gate / 2, sy + half - thick, gate, thick);
        if (s.walls >= 2) {
          const tw = Math.max(3, unit * 0.3);
          ctx.fillStyle = '#5a5340';
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
            ctx.fillRect(
              sx + dx * half - tw / 2,
              sy + dy * half - tw / 2,
              tw, tw,
            );
          });
        }
      }

      // 建筑群：等级越高房子越多，沿两圈有序排布，彼此留出间隙
      const houseCount = [2, 4, 6, 8, 11][s.tier] ?? 2;
      const spread = unit * (s.walls > 0 ? 1.5 : 1.55);
      const roof = shade(race.rgb, 0.95);
      const roofDark = shade(race.rgb, 0.66);
      const seed = s.id * 7919 + 13;
      const innerCount = Math.min(3, houseCount);

      for (let k = 0; k < houseCount; k++) {
        const ring = k < innerCount ? 0 : 1;
        const idxInRing = ring === 0 ? k : k - innerCount;
        const perRing = ring === 0 ? innerCount : Math.max(1, houseCount - innerCount);
        // 内圈转 45° 错开，避免和外圈重叠
        const a = (idxInRing / perRing) * Math.PI * 2 + (ring === 0 ? Math.PI / 4 : 0) + hash2(seed, k) * 0.35;
        const rr = spread * (ring === 0 ? 0.42 : 1) * (0.9 + hash2(seed + 41, k) * 0.2);
        const bx = sx + Math.cos(a) * rr;
        const by = sy + Math.sin(a) * rr * 0.72;
        const hw = Math.max(6, unit * 0.62);
        const hh = Math.max(6, unit * 0.58);
        const bx0 = Math.round(bx - hw / 2);
        const by0 = Math.round(by - hh / 2);
        const bw = Math.round(hw);
        const bh = Math.round(hh);
        const ridgeY = by0 + Math.round(bh * 0.12);
        const eaveY = by0 + Math.round(bh * 0.46);
        const wallTop = eaveY;
        const wallH = bh - Math.round(bh * 0.46);

        // 落地影
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(bx0 + 2, by0 + bh - 1, bw, Math.max(1, Math.round(bh * 0.16)));

        // 墙体（亮米白）
        ctx.fillStyle = k % 3 === 0 ? '#f2e9d2' : '#e0d4b4';
        ctx.fillRect(bx0, wallTop, bw, wallH);
        // 右侧墙背光面
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(bx0 + Math.round(bw * 0.62), wallTop, Math.round(bw * 0.38), wallH);
        // 窗
        if (bw >= 8) {
          ctx.fillStyle = 'rgba(46,36,24,0.7)';
          ctx.fillRect(bx0 + Math.round(bw * 0.12), wallTop + Math.round(wallH * 0.18), Math.max(1, Math.round(bw * 0.16)), Math.max(1, Math.round(wallH * 0.3)));
        }
        // 门
        if (bw >= 7) {
          ctx.fillStyle = 'rgba(40,30,18,0.85)';
          ctx.fillRect(
            bx0 + Math.round(bw * 0.42),
            wallTop + Math.round(wallH * 0.4),
            Math.max(1, Math.round(bw * 0.2)),
            Math.max(2, wallH - Math.round(wallH * 0.4)),
          );
        }

        // 屋顶：倒梯形（屋脊在上），带明暗两面
        ctx.fillStyle = k % 2 === 0 ? roof : roofDark;
        ctx.beginPath();
        ctx.moveTo(bx0 + bw * 0.5, ridgeY);
        ctx.lineTo(bx0 + bw, eaveY);
        ctx.lineTo(bx0, eaveY);
        ctx.closePath();
        ctx.fill();
        // 屋顶背光右半
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.moveTo(bx0 + bw * 0.5, ridgeY);
        ctx.lineTo(bx0 + bw, eaveY);
        ctx.lineTo(bx0 + bw * 0.5, eaveY);
        ctx.closePath();
        ctx.fill();
        // 屋脊高光
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(bx0 + Math.round(bw * 0.4), ridgeY, Math.max(1, Math.round(bw * 0.2)), 1);
        // 屋檐轮廓
        ctx.fillStyle = 'rgba(20,15,10,0.45)';
        ctx.fillRect(bx0, eaveY, bw, 1);
      }

      // 都城王宫
      if (s.capital && s.tier >= 2) {
        const cw = Math.max(3, unit * 0.42);
        ctx.fillStyle = '#e8dcbc';
        ctx.fillRect(Math.round(sx - cw / 2), Math.round(sy - cw * 0.7), Math.round(cw), Math.round(cw));
        ctx.fillStyle = roof;
        ctx.fillRect(Math.round(sx - cw / 2), Math.round(sy - cw * 0.7), Math.round(cw), Math.max(1, Math.round(cw * 0.4)));
        ctx.fillStyle = '#8a7a55';
        ctx.fillRect(Math.round(sx), Math.round(sy - cw * 1.5), Math.max(1, unit * 0.1), Math.round(cw * 0.8));
        ctx.fillStyle = race.color;
        ctx.fillRect(Math.round(sx + unit * 0.1), Math.round(sy - cw * 1.5), Math.max(2, unit * 0.22), Math.max(1, unit * 0.14));
      }

      // 小人：站在房屋外圈，尺寸足够看出人形
      if (z >= 6) {
        const people = Math.min(8, Math.max(3, Math.floor(s.pop / 70)));
        const pseed = s.id * 131 + 7;
        const headW = Math.max(3, Math.round(z * 0.3));
        const bodyW = Math.max(3, Math.round(z * 0.32));
        const bodyH = Math.max(5, Math.round(z * 0.56));
        const skin = '#f2cfa8';

        for (let k = 0; k < people; k++) {
          const a = (k / people) * Math.PI * 2 + hash2(pseed, k) * 0.5;
          const rr = unit * (1.72 + hash2(pseed + 17, k) * 0.26);
          const px = Math.round(sx + Math.cos(a) * rr);
          const py = Math.round(sy + Math.sin(a) * rr * 0.72);
          const topY = py - headW;
          const legH = Math.max(2, Math.round(z * 0.16));
          const totalH = headW + bodyH + legH;

          // 落地影子
          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.fillRect(px - 1, py + bodyH, bodyW + 2, Math.max(1, Math.round(z * 0.09)));
          // 深色底：让小人从地形里跳出来
          ctx.fillStyle = 'rgba(8,6,3,0.42)';
          ctx.fillRect(px - 1, topY - 1, bodyW + 2, totalH + 2);
          // 头（肤色）
          ctx.fillStyle = skin;
          ctx.fillRect(px, topY, headW, headW);
          // 头发/头盔
          ctx.fillStyle = shade(race.rgb, 0.85);
          ctx.fillRect(px, topY, headW, Math.max(1, Math.round(headW * 0.45)));
          // 身体
          ctx.fillStyle = k % 3 === 0 ? race.color : shade(race.rgb, 0.85);
          ctx.fillRect(px, topY + headW, bodyW, bodyH);
          // 腰带
          ctx.fillStyle = 'rgba(20,15,8,0.5)';
          ctx.fillRect(px, topY + headW + Math.floor(bodyH * 0.6), bodyW, 1);
          // 腿
          ctx.fillStyle = shade(race.rgb, 0.5);
          ctx.fillRect(px, topY + headW + bodyH, Math.max(1, Math.round(bodyW * 0.38)), legH);
          ctx.fillRect(px + Math.max(1, Math.round(bodyW * 0.58)), topY + headW + bodyH, Math.max(1, Math.round(bodyW * 0.38)), legH);
        }
      }

      // 人口数字
      if (z >= 16) {
        const label = String(Math.round(s.pop));
        ctx.font = `bold ${Math.max(8, Math.round(z * 0.5))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const ty = sy - unit * 1.05;
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
        const pad = unit * 0.9;
        ctx.strokeRect(Math.round(sx - pad), Math.round(sy - pad), Math.round(pad * 2), Math.round(pad * 2));
      }
    }
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
      const k = s.nation >= 0 ? 0.92 : 0.58;
      map.set(s.id, [rgb[0] * k, rgb[1] * k, rgb[2] * k]);
    }
    return map;
  }
}

/** 每格用多少细节像素：必须是 zoom 的约数，保证 1 个细节像素 = 整数个屏幕像素 */
function pickTile(zoom: number): number {
  if (zoom >= 8 && zoom % 8 === 0) return 8;
  if (zoom >= 4 && zoom % 4 === 0) return 4;
  return 1;
}

function sameRegion(a: Region, b: Region): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

function pack(r: number, g: number, b: number): number {
  const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return (255 << 24) | (bi << 16) | (gi << 8) | ri;
}

function shade(rgb: [number, number, number], k: number): string {
  const r = Math.min(255, Math.round(rgb[0] * k));
  const g = Math.min(255, Math.round(rgb[1] * k));
  const b = Math.min(255, Math.round(rgb[2] * k));
  return `rgb(${r},${g},${b})`;
}
