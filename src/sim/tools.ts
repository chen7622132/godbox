import { Rng } from '../core/rng';
import { logEvent } from '../core/events';
import { T, IS_LAND, type ToolId, type World } from '../core/types';
import { RACES } from '../core/races';
import { createSettlement } from './simulation';
import { ignite, startPlague, earthquake, meteor, flood } from './disasters';

const rng = new Rng(31);

export interface ToolDef {
  id: ToolId;
  group: string;
  label: string;
  hint: string;
  glyph: string;
  danger?: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: 'inspect', group: '观测', label: '查看', hint: '点击格子或聚落查看详情', glyph: '⊕' },

  { id: 'spawn_human', group: '生命', label: '人类', hint: '放下一个人类营地（草原/沙地）', glyph: '人' },
  { id: 'spawn_elf', group: '生命', label: '精灵', hint: '放下一个精灵营地（森林/雪原）', glyph: '灵' },
  { id: 'spawn_dwarf', group: '生命', label: '矮人', hint: '放下一个矮人营地（丘陵/山地）', glyph: '矮' },
  { id: 'spawn_orc', group: '生命', label: '兽人', hint: '放下一个兽人营地（草原/沼泽）', glyph: '兽' },

  { id: 'terra_grass', group: '造陆', label: '草原', hint: '把土地刷成可耕种草原', glyph: '·' },
  { id: 'terra_forest', group: '造陆', label: '森林', hint: '造林（精灵最爱）', glyph: '♣' },
  { id: 'terra_mountain', group: '造陆', label: '山地', hint: '造山（矮人可居）', glyph: '▲' },
  { id: 'terra_sand', group: '造陆', label: '沙地', hint: '造沙滩/荒漠', glyph: '░' },
  { id: 'terra_water', group: '造陆', label: '水域', hint: '挖海、开运河', glyph: '≈' },

  { id: 'bless_fert', group: '神迹', label: '丰收', hint: '提升土地肥力', glyph: '✿' },
  { id: 'bless_heal', group: '神迹', label: '治愈', hint: '灭火、消瘟疫、救人', glyph: '✚' },
  { id: 'bless_tech', group: '神迹', label: '赐智', hint: '赐予附近国家科技', glyph: '✦' },

  { id: 'dis_fire', group: '灾难', label: '天火', hint: '点燃大地', glyph: '🔥', danger: true },
  { id: 'dis_plague', group: '灾难', label: '瘟疫', hint: '放出一场瘟疫', glyph: '☠', danger: true },
  { id: 'dis_quake', group: '灾难', label: '地震', hint: '撕裂大地', glyph: '≡', danger: true },
  { id: 'dis_meteor', group: '灾难', label: '陨石', hint: '砸出一个坑', glyph: '☄', danger: true },
  { id: 'dis_flood', group: '灾难', label: '洪水', hint: '淹没大地', glyph: '≋', danger: true },
  { id: 'kill', group: '灾难', label: '抹除', hint: '抹掉范围内的聚落', glyph: '✖', danger: true },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));

export function toolById(id: ToolId): ToolDef | undefined {
  return TOOL_MAP.get(id);
}

function inRadius(world: World, cx: number, cy: number, r: number, fn: (i: number, x: number, y: number, d2: number) => void): void {
  const { w, h } = world;
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      fn(y * w + x, x, y, d2);
    }
  }
}

/** 该格上是否有活聚落 */
function settlementAt(world: World, i: number) {
  return world.settlements.find((s) => s.alive && !s.ruin && s.y * world.w + s.x === i);
}

export function applyTool(world: World, tool: ToolId, x: number, y: number, radius: number): void {
  rng.s = world.rngState;
  const { w, terrain, fert } = world;
  const i0 = y * w + x;
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return;

  switch (tool) {
    // ---------- 造陆 ----------
    case 'terra_grass':
    case 'terra_forest':
    case 'terra_mountain':
    case 'terra_sand':
    case 'terra_water': {
      const target =
        tool === 'terra_grass' ? T.Grass :
        tool === 'terra_forest' ? T.Forest :
        tool === 'terra_mountain' ? T.Mountain :
        tool === 'terra_sand' ? T.Sand : T.Water;
      inRadius(world, x, y, radius, (i) => {
        if (settlementAt(world, i)) return; // 保住城市
        terrain[i] = target;
        if (target === T.Water) {
          fert[i] = 0;
          world.fire[i] = 0;
          world.owner[i] = -1;
          world.nationOf[i] = -1;
        } else if (target === T.Mountain) {
          fert[i] = 30;
        } else if (target === T.Forest) {
          fert[i] = Math.max(fert[i], 150);
        } else if (target === T.Grass) {
          fert[i] = Math.max(fert[i], 170);
        } else {
          fert[i] = Math.max(fert[i], 60);
        }
      });
      break;
    }

    // ---------- 生命 ----------
    case 'spawn_human':
    case 'spawn_elf':
    case 'spawn_dwarf':
    case 'spawn_orc': {
      const race = tool === 'spawn_human' ? 0 : tool === 'spawn_elf' ? 1 : tool === 'spawn_dwarf' ? 2 : 3;
      const def = RACES[race];
      // 找最近的合规陆地
      let spot = -1;
      for (let r = 0; r <= 12 && spot < 0; r++) {
        inRadius(world, x, y, r, (i, ix, iy) => {
          if (spot >= 0) return;
          const t = terrain[i];
          if (!IS_LAND[t]) return;
          if (world.owner[i] !== -1) return;
          if (settlementAt(world, i)) return;
          if (!def.pref.includes(t) && r < 3) return; // 优先偏好地形
          if (Math.abs(ix - x) + Math.abs(iy - y) > r * 1.4) return;
          spot = i;
        });
      }
      if (spot < 0) {
        toastLog(world, `这里放不下${def.name}，换个地方试试`);
        return;
      }
      const sx = spot % w;
      const sy = (spot / w) | 0;
      const s = createSettlement(world, sx, sy, race, 12, false);
      logEvent(world, 'gift', `神在 ${s.name} 撒下了${def.name}的火种`, race, 1);
      break;
    }

    // ---------- 神迹 ----------
    case 'bless_fert':
      world.stats.gifts++;
      inRadius(world, x, y, radius, (i) => {
        fert[i] = Math.min(255, fert[i] + 70);
        if (terrain[i] === T.Sand && rng.chance(0.4)) terrain[i] = T.Grass;
        if (terrain[i] === T.Snow && rng.chance(0.25)) terrain[i] = T.Grass;
      });
      break;

    case 'bless_heal':
      world.stats.gifts++;
      inRadius(world, x, y, radius, (i) => {
        world.fire[i] = 0;
        world.plague[i] = 0;
      });
      world.hasFire = world.fire.some((v) => v > 0);
      world.hasPlague = world.plague.some((v) => v > 0);
      for (const s of world.settlements) {
        if (!s.alive || s.ruin) continue;
        if (Math.hypot(s.x - x, s.y - y) > radius + 2) continue;
        s.pop *= 1.25;
      }
      break;

    case 'bless_tech': {
      const nids = new Set<number>();
      inRadius(world, x, y, radius + 6, (i) => {
        const nid = world.nationOf[i];
        if (nid >= 0) nids.add(nid);
      });
      for (const nid of nids) {
        const n = world.nations[nid];
        if (!n || !n.alive || n.tech >= 6) continue;
        n.techProgress += 60;
        if (n.techProgress >= 100) {
          n.techProgress = 0;
          n.tech++;
          logEvent(world, 'tech', `神启！${n.name} 直接掌握了更高明的技艺`, n.race, 1);
        }
      }
      break;
    }

    // ---------- 灾难 ----------
    case 'dis_fire':
      ignite(world, x, y, Math.max(1, radius));
      break;
    case 'dis_plague':
      startPlague(world, x, y, Math.max(1, radius));
      break;
    case 'dis_quake':
      earthquake(world, x, y, Math.max(2, radius + 1));
      break;
    case 'dis_meteor':
      meteor(world, x, y, Math.max(2, radius + 2));
      break;
    case 'dis_flood':
      flood(world, x, y, Math.max(2, radius + 2));
      break;

    case 'kill': {
      const hit = settlementAt(world, i0);
      if (hit) {
        hit.alive = false;
        hit.ruin = true;
        hit.pop = 0;
        terrain[i0] = T.Ruin;
        world.stats.citiesDestroyed++;
        logEvent(world, 'ruin', `${hit.name} 被神之手抹去，仿佛从未存在过`, hit.race, 2);
        const n = hit.nation >= 0 ? world.nations[hit.nation] : undefined;
        if (n) {
          const idx = n.cities.indexOf(hit.id);
          if (idx >= 0) n.cities.splice(idx, 1);
          if (n.cities.length === 0) {
            n.alive = false;
            logEvent(world, 'extinct', `${n.name} 随之覆灭`, n.race, 2);
          }
        }
      } else {
        inRadius(world, x, y, radius, (i) => {
          world.fire[i] = 0;
          world.plague[i] = 0;
          if (terrain[i] !== T.Deep && terrain[i] !== T.Water) {
            terrain[i] = T.Ruin;
            fert[i] = 20;
            world.owner[i] = -1;
          }
        });
      }
      break;
    }

    default:
      break;
  }
  world.rngState = rng.s;
}

/** 轻量提示（由 UI 层接管，这里只记事件避免静默失败） */
let toastSink: ((msg: string) => void) | null = null;
export function setToastSink(fn: (msg: string) => void): void {
  toastSink = fn;
}
function toastLog(_world: World, msg: string): void {
  if (toastSink) toastSink(msg);
}
