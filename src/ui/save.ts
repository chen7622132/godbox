import type { World } from '../core/types';

/**
 * 存档：浏览器 localStorage（快速保存/读取）+ 导出文件（可分享、可提交 git）。
 * TypedArray 用 base64 压缩，比 JSON 数字数组小一个数量级。
 */

const LS_KEY = 'godbox.save.v1';
const SAVE_VERSION = 1;

function b64FromU8(u8: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    out += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(out);
}

function u8FromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export interface SaveBlob {
  v: number;
  w: number;
  h: number;
  seed: number;
  rngState: number;
  year: number;
  tick: number;
  terrain: string;
  fert: string;
  owner: string;
  nationOf: string;
  fire: string;
  plague: string;
  settlements: World['settlements'];
  nations: World['nations'];
  agents: World['agents'];
  events: World['events'];
  stats: World['stats'];
  ended: boolean;
  endReason: string;
  extincted: boolean[];
  overtime?: boolean;
}

export function serialize(world: World): SaveBlob {
  return {
    v: SAVE_VERSION,
    w: world.w,
    h: world.h,
    seed: world.seed,
    rngState: world.rngState,
    year: world.year,
    tick: world.tick,
    terrain: b64FromU8(world.terrain),
    fert: b64FromU8(world.fert),
    owner: b64FromU8(new Uint8Array(world.owner.buffer, world.owner.byteOffset, world.owner.byteLength)),
    nationOf: b64FromU8(
      new Uint8Array(world.nationOf.buffer, world.nationOf.byteOffset, world.nationOf.byteLength),
    ),
    fire: b64FromU8(world.fire),
    plague: b64FromU8(world.plague),
    settlements: world.settlements,
    nations: world.nations,
    agents: world.agents,
    events: world.events.slice(-400),
    stats: world.stats,
    ended: world.ended,
    endReason: world.endReason,
    extincted: world.extincted,
    overtime: world.overtime,
  };
}

export function deserialize(blob: unknown): World {
  const b = blob as SaveBlob;
  if (!b || typeof b !== 'object' || b.v !== SAVE_VERSION) {
    throw new Error('存档版本不兼容');
  }
  const w = b.w;
  const h = b.h;
  const ownerBuf = u8FromB64(b.owner);
  const nationBuf = u8FromB64(b.nationOf);
  const owner = new Int32Array(ownerBuf.buffer, ownerBuf.byteOffset, ownerBuf.byteLength / 4);
  const nationOf = new Int16Array(nationBuf.buffer, nationBuf.byteOffset, nationBuf.byteLength / 2);

  const world: World = {
    w, h,
    terrain: u8FromB64(b.terrain).slice(0, w * h),
    fert: u8FromB64(b.fert).slice(0, w * h),
    owner,
    nationOf,
    fire: u8FromB64(b.fire).slice(0, w * h),
    plague: u8FromB64(b.plague).slice(0, w * h),
    seed: b.seed,
    rngState: b.rngState,
    year: b.year,
    tick: b.tick,
    settlements: b.settlements,
    nations: b.nations,
    agents: b.agents,
    events: b.events,
    stats: b.stats,
    ended: b.ended,
    endReason: b.endReason,
    extincted: b.extincted ?? [false, false, false, false],
    hasFire: false,
    hasPlague: false,
    overtime: (b as { overtime?: boolean }).overtime ?? false,
  };
  world.hasFire = world.fire.some((v) => v > 0);
  world.hasPlague = world.plague.some((v) => v > 0);
  if (world.stats.popHistory.length > 400) {
    world.stats.popHistory = world.stats.popHistory.slice(-400);
  }

  // ---- 旧存档兼容：v1.5 新增的人物/博弈字段，缺了就补默认值 ----
  for (const s of world.settlements) {
    if (s.mood === undefined) {
      s.mood = 'normal';
      s.happiness = 0;
      s.foodKind = s.favFood ?? 0;
      s.lastMeal = world.tick;
      s.status = null;
      s.statusUntil = 0;
      s.miseryTicks = 0;
      s.damage = 0;
    }
  }
  for (const n of world.nations) {
    if (!n.grudge) n.grudge = [];
    if (!n.doctrine) n.doctrine = 'conquer';
    if (!n.dynasty) n.dynasty = '';
    if (n.warCount === undefined) n.warCount = 0;
    if (n.fractured === undefined) n.fractured = false;
  }
  for (const a of world.agents) {
    if (a.traits === undefined) a.traits = ['好战', '谨慎'];
    if (!a.ambition) a.ambition = 'glory';
    if (a.epithet === undefined) a.epithet = '';
    if (a.father === undefined) a.father = null;
    if (a.killedBy === undefined) a.killedBy = -1;
    if (a.nemesis === undefined) a.nemesis = -1;
    if (a.warsWon === undefined) a.warsWon = 0;
    if (a.warsLost === undefined) a.warsLost = 0;
    if (a.citiesTaken === undefined) a.citiesTaken = 0;
    if (a.citiesLost === undefined) a.citiesLost = 0;
    if (a.popSlain === undefined) a.popSlain = 0;
    if (a.citiesFounded === undefined) a.citiesFounded = 0;
    if (a.reign === undefined) a.reign = 0;
    if (!a.deeds) a.deeds = [];
    if (a.cause === undefined) a.cause = null;
    if (a.diedYear === undefined) a.diedYear = null;
  }
  return world;
}

export function saveToLocal(world: World): void {
  localStorage.setItem(LS_KEY, JSON.stringify(serialize(world)));
}

export function loadFromLocal(): World | null {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  return deserialize(JSON.parse(raw));
}

export function hasLocalSave(): boolean {
  return localStorage.getItem(LS_KEY) !== null;
}

export function downloadSave(world: World): void {
  const data = JSON.stringify(serialize(world));
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  a.download = `godbox-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readSaveFile(file: File): Promise<World> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        resolve(deserialize(JSON.parse(String(fr.result))));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('存档解析失败'));
      }
    };
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.readAsText(file);
  });
}
