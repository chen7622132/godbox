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

const TILE_HI = 4;
const TILE_LO = 1;

/** 确定性噪声：同一个坐标永远返回同一个值，不会逐帧闪烁 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 单个格子里每个细节像素的亮度乘数。
 * 这是在 4×4 的尺度上"画"一块地：草有草点、树有树冠和树干、山有山脊、水有波光。
 */
function tileShade(t: number, px: number, py: number, n: number): number {
  switch (t) {
    case T.Grass: {
      // 草丛：底色 + 随机深点，偶尔一点亮黄（小花）
      if (n > 0.93) return 1.18;
      return 0.94 + n * 0.13;
    }
    case T.Forest: {
      // 一棵树：中间一团亮树冠，四周压暗当背景，底下一根深色树干
      if (py === 0) return (px === 1 || px === 2) ? 1.24 : 0.78;
      if (py === 1) return (px === 0 || px === 3) ? 0.7 : 1.32;
      if (py === 2) return (px === 0 || px === 3) ? 0.68 : 1.06;
      // py === 3
      return (px === 1 || px === 2) ? 0.44 : 0.6;
    }
    case T.Water: {
      // 水：横向波光
      if (py === 1 && n > 0.62) return 1.22;
      if (py === 3 && n > 0.78) return 1.12;
      return 0.94 + n * 0.1;
    }
    case T.Deep: {
      if (n > 0.9) return 1.18;
      return 0.96 + n * 0.07;
    }
    case T.Sand: {
      if (n > 0.9) return 1.1;
      return 0.95 + n * 0.11;
    }
    case T.Hill: {
      // 丘陵：上半受光、下半背光，形成圆丘感
      const base = py <= 1 ? 1.08 : 0.92;
      return base * (0.95 + n * 0.1);
    }
    case T.Mountain: {
      // 山：一道斜向山脊 + 背光面
      if (px === py) return 1.24;
      if (px === py + 1) return 1.05;
      if (px < py) return 0.82;
      return 0.9 + n * 0.08;
    }
    case T.Snow: {
      if (n > 0.94) return 1.04;
      return 0.97 + n * 0.05;
    }
    case T.Swamp: {
      // 沼泽：暗底 + 积水反光 + 苔点
      if (n > 0.86) return 1.3;
      if (py === 2 && (px === 1 || px === 2)) return 0.74;
      return 0.9 + n * 0.12;
    }
    case T.Ruin: {
      if (n > 0.72) return 0.72;
      return 0.9 + n * 0.16;
    }
    default:
      return 1;
  }
}

export interface Camera {
  /** 视野中心的世界坐标 */
  x: number;
  y: number;
  /** 每格多少 CSS 像素（始终为整数，保证像素清晰） */
  zoom: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 24;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  private dpr = 1;
  /** 离屏画布里一格占多少像素：远景 1，近景 4 */
  private tile = TILE_LO;
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

    this.allocation(world);
    this.resize();
    this.fit(world);
    window.addEventListener('resize', () => this.resize());
  }

  private allocation(world: World): void {
    const t = this.cam.zoom >= 4 ? TILE_HI : TILE_LO;
    const W = world.w * t;
    const H = world.h * t;
    this.tile = t;
    this.off.width = W;
    this.off.height = H;
    this.img = this.offCtx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.dirty = true;
  }

  attachWorld(world: World): void {
    this.tintCache.clear();
    this.allocation(world);
    this.fit(world);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(320, Math.floor(r.width));
    this.cssH = Math.max(240, Math.floor(r.height));
    this.canvas.width = Math.floor(this.cssW * this.dpr);
    this.canvas.height = Math.floor(this.cssH * this.dpr);
  }

  /**
   * 缩放吸附：让 zoom 永远是「每格细节像素数」的整数倍，
   * 否则 4×4 的细节会被 3.5 倍这种非整数比例拉伸，整张图发糊、出重影。
   */
  private snapZoom(z: number): number {
    if (z < 4) return Math.max(ZOOM_MIN, Math.min(3, Math.round(z)));
    const snapped = Math.round(z / TILE_HI) * TILE_HI;
    return Math.max(TILE_HI, Math.min(ZOOM_MAX, snapped));
  }

  fit(world: World): void {
    const raw = Math.min(this.cssW / world.w, this.cssH / world.h) * 0.99;
    // 向下吸附，保证整张地图都在视野里
    const base = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(raw)));
    this.cam.zoom = base >= 4 ? Math.max(4, Math.floor(base / TILE_HI) * TILE_HI) : base;
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
  }

  clampCam(world: World): void {
    const halfW = this.cssW / 2 / this.cam.zoom;
    const halfH = this.cssH / 2 / this.cam.zoom;
    if (world.w * this.cam.zoom <= this.cssW) this.cam.x = world.w / 2;
    else this.cam.x = Math.max(halfW * 0.4, Math.min(world.w - halfW * 0.4, this.cam.x));
    if (world.h * this.cam.zoom <= this.cssH) this.cam.y = world.h / 2;
    else this.cam.y = Math.max(halfH * 0.4, Math.min(world.h - halfH * 0.4, this.cam.y));
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const nz = this.snapZoom(this.cam.zoom * factor);
    if (nz === this.cam.zoom) return;
    this.cam.zoom = nz;
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.cam.x += wx - wx2;
    this.cam.y += wy - wy2;
  }

  // ==================== 渲染主流程 ====================

  render(world: World): void {
    // 拉近才启用 4 倍细节，拉远用 1 像素/格保性能
    const wantTile = this.cam.zoom >= 4 ? TILE_HI : TILE_LO;
    if (wantTile !== this.tile || this.off.width !== world.w * wantTile) {
      this.allocation(world);
    }

    if (this.dirty) {
      this.paintGrid(world);
      this.offCtx.putImageData(this.img, 0, 0);
      this.dirty = false;
    }

    const { ctx, cssW, cssH } = this;
    const z = this.cam.zoom;
    const [vx, vy] = this.viewOrigin();

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
    ctx.strokeStyle = 'rgba(196,166,116,0.62)';
    ctx.lineWidth = Math.max(1.5, z * 0.22);
    ctx.lineCap = 'butt';

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
        if (!best || bestD > 48) continue;
        if (best.id < a.id) continue; // 一条边只画一次
        const [ax, ay] = this.worldToScreen(a.x + 0.5, a.y + 0.5);
        const [bx, by] = this.worldToScreen(best.x + 0.5, best.y + 0.5);
        if (Math.max(ax, bx) < -50 || Math.min(ax, bx) > this.cssW + 50) continue;
        if (Math.max(ay, by) < -50 || Math.min(ay, by) > this.cssH + 50) continue;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }

  // ==================== 地形层 ====================

  private paintGrid(world: World): void {
    const { w, h, terrain, fert, owner, nationOf, fire, plague } = world;
    const buf = this.buf;
    const T2 = this.tile;
    const W = w * T2;
    const tint = this.buildTint(world);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = terrain[i];
        const pal = PALETTE[t] ?? PALETTE[0];
        const f = fert[i];

        // --- 基础色 ---
        let br = pal[0];
        let bg = pal[1];
        let bb = pal[2];

        // 肥力决定明暗，草原更亮、瘠地更暗
        if (IS_LAND[t] && t !== T.Snow) {
          const v = 0.82 + (f / 255) * 0.34;
          br *= v; bg *= v; bb *= v;
        }

        // --- 领土叠色：占比调高，让势力范围一眼可辨 ---
        const oid = owner[i];
        if (oid >= 0) {
          const tc = tint.get(oid);
          if (tc) {
            br = br * 0.45 + tc[0] * 0.55;
            bg = bg * 0.45 + tc[1] * 0.55;
            bb = bb * 0.45 + tc[2] * 0.55;
          }
        }

        // --- 国界：压暗到接近黑，形成清晰的分界线 ---
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

        // --- 近岸浅水：紧邻陆地的水混合一点沙滩色，形成渐变带而不是硬边 ---
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

        // --- 灾难叠色 ---
        const fv = fire[i];
        const pv = plague[i];
        let fk = 0;
        let pk = 0;
        if (fv > 0) fk = Math.min(1, fv / 150);
        if (pv > 0) pk = Math.min(0.72, pv / 220);

        // --- 海岸：紧邻陆地的水面顶部加一道浪花 ---
        const above = y > 0 ? terrain[i - w] : t;
        const surf = !IS_LAND[t] && IS_LAND[above] ? 1.35 : 1;
        // --- 海岸阴影：下方紧邻水就加深，做出"陆地凸起"的感觉 ---
        const below = y + 1 < h ? terrain[i + w] : T.Deep;
        const cliffShadow = IS_LAND[t] && !IS_LAND[below] ? 0.82 : 1;

        if (T2 === 1) {
          let r = br, g = bg, b = bb;
          if (fk > 0) {
            r = r * (1 - fk) + (FIRE_HOT_RGB[0] * 0.45 + FIRE_RGB[0] * 0.55) * fk;
            g = g * (1 - fk) + (FIRE_HOT_RGB[1] * 0.45 + FIRE_RGB[1] * 0.55) * fk;
            b = b * (1 - fk) + (FIRE_HOT_RGB[2] * 0.35 + FIRE_RGB[2] * 0.35) * fk;
          }
          if (pk > 0) {
            r = r * (1 - pk) + PLAGUE_RGB[0] * pk;
            g = g * (1 - pk) + PLAGUE_RGB[1] * pk;
            b = b * (1 - pk) + PLAGUE_RGB[2] * pk;
          }
          buf[y * W + x] = pack(r, g, b);
          continue;
        }

        // --- 4×4 细节 ---
        const ox = x * T2;
        const oyBase = y * T2;
        const seedA = hash2(x, y) * 1000;

        for (let py = 0; py < T2; py++) {
          const rowBase = (oyBase + py) * W + ox;
          for (let px = 0; px < T2; px++) {
            const n = hash2(x * 7 + px + seedA, y * 13 + py);
            let shade = tileShade(t, px, py, n);
            // 底部一行压暗 = 整个地块的落地阴影
            if (py === T2 - 1) shade *= 0.9;
            shade *= cliffShadow;
            if (surf > 1 && py === 0) shade *= surf;

            let r = br * shade;
            let g = bg * shade;
            let b = bb * shade;

            if (fk > 0) {
              r = r * (1 - fk) + (FIRE_HOT_RGB[0] * 0.45 + FIRE_RGB[0] * 0.55) * fk;
              g = g * (1 - fk) + (FIRE_HOT_RGB[1] * 0.45 + FIRE_RGB[1] * 0.55) * fk;
              b = b * (1 - fk) + (FIRE_HOT_RGB[2] * 0.35 + FIRE_RGB[2] * 0.35) * fk;
            }
            if (pk > 0) {
              r = r * (1 - pk) + PLAGUE_RGB[0] * pk;
              g = g * (1 - pk) + PLAGUE_RGB[1] * pk;
              b = b * (1 - pk) + PLAGUE_RGB[2] * pk;
            }

            buf[rowBase + px] = pack(r, g, b);
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
      if (sx < -60 || sy < -60 || sx > this.cssW + 60 || sy > this.cssH + 60) continue;

      const race = RACES[s.race];
      const unit = z; // 一格的屏幕尺寸

      if (z < 3) {
        // 远景：只画一个方块标点，保持干净
        const size = Math.max(2, Math.round(unit * 0.55));
        ctx.fillStyle = race.color;
        ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
        if (s.capital) {
          ctx.fillStyle = '#fff3c4';
          ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, Math.max(1, size / 3));
        }
        continue;
      }

      // ---- 落地阴影 ----
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + unit * 0.42, unit * 0.62, unit * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // ---- 城墙 ----
      const wallSize = unit * 1.25;
      if (s.walls > 0) {
        ctx.fillStyle = '#57503f';
        ctx.fillRect(sx - wallSize / 2, sy - wallSize / 2, wallSize, wallSize);
        ctx.fillStyle = '#6b6350';
        ctx.fillRect(sx - wallSize / 2, sy - wallSize / 2, wallSize, Math.max(1, wallSize * 0.18));
        // 城门缺口
        ctx.fillStyle = '#3a3529';
        const gate = Math.max(1, wallSize * 0.22);
        ctx.fillRect(sx - gate / 2, sy + wallSize / 2 - gate, gate, gate);
        if (s.walls >= 2) {
          // 角楼
          const tw = Math.max(2, wallSize * 0.2);
          ctx.fillStyle = '#4a4436';
          ctx.fillRect(sx - wallSize / 2 - tw * 0.4, sy - wallSize / 2 - tw * 0.4, tw, tw);
          ctx.fillRect(sx + wallSize / 2 - tw * 0.6, sy - wallSize / 2 - tw * 0.4, tw, tw);
          ctx.fillRect(sx - wallSize / 2 - tw * 0.4, sy + wallSize / 2 - tw * 0.6, tw, tw);
          ctx.fillRect(sx + wallSize / 2 - tw * 0.6, sy + wallSize / 2 - tw * 0.6, tw, tw);
        }
      }

      // ---- 建筑群：等级越高房子越多 ----
      const houseCount = [2, 3, 5, 7, 10][s.tier] ?? 2;
      const spread = unit * (s.walls > 0 ? 0.62 : 0.85);
      const roof = shade(race.rgb, 1.15);
      const roofDark = shade(race.rgb, 0.72);
      const seed = s.id * 7919 + 13;

      for (let k = 0; k < houseCount; k++) {
        const a = hash2(seed, k) * Math.PI * 2;
        const rr = hash2(seed + 41, k) * spread;
        const bx = sx + Math.cos(a) * rr;
        const by = sy + Math.sin(a) * rr * 0.72;
        const hw = Math.max(3, unit * 0.4);
        const hh = Math.max(3, unit * 0.34);

        // 房屋自身投影
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(Math.round(bx - hw / 2) + 1, Math.round(by - hh / 2) + 2, Math.round(hw), Math.round(hh));
        // 墙
        ctx.fillStyle = k % 3 === 0 ? '#e0d3b2' : '#c9ba97';
        ctx.fillRect(Math.round(bx - hw / 2), Math.round(by - hh / 2), Math.round(hw), Math.round(hh));
        // 屋顶（种族色，带一点高光）
        ctx.fillStyle = k % 2 === 0 ? roof : roofDark;
        ctx.fillRect(Math.round(bx - hw / 2), Math.round(by - hh / 2), Math.round(hw), Math.max(2, Math.round(hh * 0.45)));
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(Math.round(bx - hw / 2), Math.round(by - hh / 2), Math.round(hw), 1);
        // 门（深色小方块，让"这是房子"一眼可辨）
        if (hw >= 4) {
          ctx.fillStyle = 'rgba(40,32,22,0.75)';
          ctx.fillRect(Math.round(bx - hw * 0.12), Math.round(by + hh * 0.14), Math.max(1, Math.round(hw * 0.24)), Math.max(1, Math.round(hh * 0.28)));
        }
      }

      // ---- 都城王宫 ----
      if (s.capital && s.tier >= 2) {
        const cw = Math.max(3, unit * 0.42);
        ctx.fillStyle = '#e8dcbc';
        ctx.fillRect(Math.round(sx - cw / 2), Math.round(sy - cw * 0.7), Math.round(cw), Math.round(cw));
        ctx.fillStyle = roof;
        ctx.fillRect(Math.round(sx - cw / 2), Math.round(sy - cw * 0.7), Math.round(cw), Math.max(1, Math.round(cw * 0.4)));
        // 旗杆
        ctx.fillStyle = '#8a7a55';
        ctx.fillRect(Math.round(sx), Math.round(sy - cw * 1.5), Math.max(1, unit * 0.1), Math.round(cw * 0.8));
        ctx.fillStyle = race.color;
        ctx.fillRect(Math.round(sx + unit * 0.1), Math.round(sy - cw * 1.5), Math.max(2, unit * 0.22), Math.max(1, unit * 0.14));
      }

      // ---- 人口：站在城边的小人（能看出是人形） ----
      if (z >= 6) {
        const people = Math.min(9, Math.max(2, Math.floor(s.pop / 70)));
        const pseed = s.id * 131 + 7;
        const headW = Math.max(2, Math.round(z * 0.18));
        const bodyW = Math.max(2, Math.round(z * 0.2));
        const bodyH = Math.max(3, Math.round(z * 0.38));
        const skin = '#efc8a0';

        for (let k = 0; k < people; k++) {
          const a = hash2(pseed, k) * Math.PI * 2;
          const rr = unit * (0.7 + hash2(pseed + 17, k) * 0.45);
          const px = Math.round(sx + Math.cos(a) * rr);
          const py = Math.round(sy + Math.sin(a) * rr * 0.72);
          const topY = py - headW;

          // 落地影子
          ctx.fillStyle = 'rgba(0,0,0,0.32)';
          ctx.fillRect(px - Math.round(bodyW * 0.3), py + bodyH, bodyW + 1, Math.max(1, Math.round(z * 0.07)));
          // 头
          ctx.fillStyle = skin;
          ctx.fillRect(px, topY, headW, headW);
          // 身体（种族色，深浅交替做出层次）
          ctx.fillStyle = k % 3 === 0 ? race.color : shade(race.rgb, 0.85);
          ctx.fillRect(px, topY + headW, bodyW, bodyH);
          // 腿
          ctx.fillStyle = shade(race.rgb, 0.55);
          ctx.fillRect(px, topY + headW + bodyH, Math.max(1, Math.round(bodyW * 0.35)), Math.max(1, Math.round(z * 0.1)));
        }
      }

      // ---- 人口数字：只在很近时出现，描边而不是黑底框，避免破坏画面 ----
      if (z >= 16) {
        const label = String(Math.round(s.pop));
        ctx.font = `bold ${Math.max(8, Math.round(z * 0.58))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const ty = sy - unit * 1.05;
        ctx.lineWidth = Math.max(2, z * 0.18);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(4,7,11,0.88)';
        ctx.strokeText(label, sx, ty);
        ctx.fillStyle = '#ffeeb0';
        ctx.fillText(label, sx, ty);
      }

      // ---- 选中 ----
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

/** 把 [r,g,b] 压进小端序的 ABGR 整数 */
function pack(r: number, g: number, b: number): number {
  const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return (255 << 24) | (bi << 16) | (gi << 8) | ri;
}

/** 按倍率调整颜色，用于生成同一色系的深浅 */
function shade(rgb: [number, number, number], k: number): string {
  const r = Math.min(255, Math.round(rgb[0] * k));
  const g = Math.min(255, Math.round(rgb[1] * k));
  const b = Math.min(255, Math.round(rgb[2] * k));
  return `rgb(${r},${g},${b})`;
}
