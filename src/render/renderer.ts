import { T, IS_LAND, type World } from '../core/types';
import { RACES } from '../core/races';

/** 地形基础色 [r,g,b] —— 仿 WorldBox 的低饱和像素调色 */
const PALETTE: [number, number, number][] = [
  [22, 48, 82],    // Deep 深海
  [40, 96, 138],   // Water 浅海
  [214, 194, 138], // Sand 沙滩
  [104, 158, 78],  // Grass 草原
  [56, 108, 62],   // Forest 森林
  [140, 148, 96],  // Hill 丘陵
  [128, 122, 112], // Mountain 山地
  [230, 238, 244], // Snow 雪原
  [78, 92, 68],    // Swamp 沼泽
  [104, 96, 88],   // Ruin 废墟
];

const FIRE: [number, number, number] = [246, 132, 40];
const FIRE_HOT: [number, number, number] = [255, 232, 140];
const PLAGUE: [number, number, number] = [140, 60, 150];

export interface Camera {
  /** 视野中心的世界坐标 */
  x: number;
  y: number;
  /** 每格多少 CSS 像素（始终为整数，保证像素清晰） */
  zoom: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 22;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;
  private dpr = 1;
  cssW = 1;
  cssH = 1;

  cam: Camera = { x: 0, y: 0, zoom: 4 };
  hover: { x: number; y: number } | null = null;
  hoverRadius = 2;
  brushPreview: { tool: string } | null = null;
  selected: number | null = null;

  private tintCache = new Map<number, [number, number, number]>();
  /** 世界状态变了才需要重画格子层 */
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
    this.off.width = world.w;
    this.off.height = world.h;
    const offCtx = this.off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) throw new Error('离屏 Canvas 不可用');
    this.offCtx = offCtx;

    this.img = offCtx.createImageData(world.w, world.h);
    this.buf = new Uint32Array(this.img.data.buffer);

    this.resize();
    this.fit(world);
    window.addEventListener('resize', () => this.resize());
  }

  /** 世界尺寸变化（读档/新世界）时重建离屏画布 */
  attachWorld(world: World): void {
    this.off.width = world.w;
    this.off.height = world.h;
    this.img = this.offCtx.createImageData(world.w, world.h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.tintCache.clear();
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

  fit(world: World): void {
    const z = Math.min(this.cssW / world.w, this.cssH / world.h) * 0.99;
    this.cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z)));
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

  /** 钳制相机，别让玩家飘到虚空里 */
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
    const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(this.cam.zoom * factor)));
    if (nz === this.cam.zoom) return;
    this.cam.zoom = nz;
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.cam.x += wx - wx2;
    this.cam.y += wy - wy2;
  }

  // ============ 渲染 ============

  render(world: World): void {
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
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.drawImage(this.off, -vx * z, -vy * z, world.w * z, world.h * z);

    this.drawMarkers(world);
    this.drawHover();
  }

  private drawMarkers(world: World): void {
    const { ctx } = this;
    const z = this.cam.zoom;

    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      if (sx < -30 || sy < -30 || sx > this.cssW + 30 || sy > this.cssH + 30) continue;

      const race = RACES[s.race];
      const base = Math.max(3, Math.round(z * 0.9));
      const size = base * (1 + s.tier * 0.35);
      const x = Math.round(sx - size / 2);
      const y = Math.round(sy - size / 2);

      // 城墙
      if (s.walls > 0) {
        ctx.fillStyle = 'rgba(60,50,40,0.85)';
        ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
      }
      // 主体
      ctx.fillStyle = race.color;
      ctx.fillRect(x, y, size, size);
      // 阴影像素，做出立体感
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + size - Math.max(1, size * 0.28), y + size - Math.max(1, size * 0.28),
        Math.max(1, size * 0.28), Math.max(1, size * 0.28));
      // 首都边框
      if (s.capital) {
        ctx.strokeStyle = '#fff6c9';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      }

      // 放大后显示人口
      if (z >= 7) {
        ctx.font = `${Math.max(9, Math.round(z * 1.1))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        const label = `${Math.round(s.pop)}`;
        const tw = ctx.measureText(label).width;
        ctx.fillRect(sx - tw / 2 - 2, y - 12, tw + 4, 11);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(label, sx, y - 2);
      }

      // 选中高亮
      if (this.selected === s.id) {
        ctx.strokeStyle = '#ffd447';
        ctx.lineWidth = 2;
        const pad = size / 2 + 4;
        ctx.beginPath();
        ctx.arc(sx, sy, pad + 2, 0, Math.PI * 2);
        ctx.stroke();
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
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(d), Math.round(d));
    ctx.setLineDash([]);
  }

  // ---- 逐格上色 ----
  private paintGrid(world: World): void {
    const { w, h, terrain, fert, owner, nationOf, fire, plague } = world;
    const buf = this.buf;
    const tint = this.buildTint(world);

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const t = terrain[i];
        const pal = PALETTE[t] ?? PALETTE[0];
        let r = pal[0];
        let g = pal[1];
        let b = pal[2];

        if (IS_LAND[t] && t !== T.Snow) {
          const v = 0.8 + (fert[i] / 255) * 0.38;
          r = Math.min(255, (r * v) | 0);
          g = Math.min(255, (g * v) | 0);
          b = Math.min(255, (b * v) | 0);
        }

        const oid = owner[i];
        if (oid >= 0) {
          const tc = tint.get(oid);
          if (tc) {
            r = (r * 0.52 + tc[0] * 0.48) | 0;
            g = (g * 0.52 + tc[1] * 0.48) | 0;
            b = (b * 0.52 + tc[2] * 0.48) | 0;
          }
        }

        // 国界 / 城界
        if (oid >= 0) {
          const nid = nationOf[i];
          const rn = x + 1 < w ? nationOf[i + 1] : -1;
          const dn = y + 1 < h ? nationOf[i + w] : -1;
          const ro = x + 1 < w ? owner[i + 1] : -1;
          const dow = y + 1 < h ? owner[i + w] : -1;
          if (nid !== rn || nid !== dn) {
            r = (r * 0.52) | 0; g = (g * 0.52) | 0; b = (b * 0.52) | 0;
          } else if (ro !== oid || dow !== oid) {
            r = (r * 0.8) | 0; g = (g * 0.8) | 0; b = (b * 0.8) | 0;
          }
        }

        const f = fire[i];
        if (f > 0) {
          const k = Math.min(1, f / 150);
          r = (r * (1 - k) + (FIRE_HOT[0] * 0.45 + FIRE[0] * 0.55) * k) | 0;
          g = (g * (1 - k) + (FIRE_HOT[1] * 0.45 + FIRE[1] * 0.55) * k) | 0;
          b = (b * (1 - k) + (FIRE_HOT[2] * 0.35 + FIRE[2] * 0.35) * k) | 0;
        }

        const p = plague[i];
        if (p > 0) {
          const k = Math.min(0.75, p / 220);
          r = (r * (1 - k) + PLAGUE[0] * k) | 0;
          g = (g * (1 - k) + PLAGUE[1] * k) | 0;
          b = (b * (1 - k) + PLAGUE[2] * k) | 0;
        }

        // 小端序：AABBGGRR
        buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
  }

  private buildTint(world: World): Map<number, [number, number, number]> {
    const map = this.tintCache;
    map.clear();
    for (const s of world.settlements) {
      if (!s.alive || s.ruin) continue;
      const rgb = RACES[s.race].rgb;
      // 独立部落偏暗，已加入国家的更亮
      const k = s.nation >= 0 ? 0.9 : 0.55;
      map.set(s.id, [rgb[0] * k, rgb[1] * k, rgb[2] * k]);
    }
    return map;
  }
}
