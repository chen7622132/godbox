import type { World, ChronicleEvent, EventKind } from './types';

/** 编年史最多保留条数 */
const MAX_EVENTS = 2400;
/** 一次清理的条数（避免每 tick 都做 O(n) 扫描） */
const PURGE_BATCH = 400;

export function logEvent(
  world: World,
  kind: EventKind,
  text: string,
  race = -1,
  level = 0,
): void {
  const ev: ChronicleEvent = { year: world.year, kind, text, race, level };
  world.events.push(ev);

  if (world.events.length > MAX_EVENTS) {
    // 关键：先丢低级别事件，重大事件（level 2）永远保留
    const kept: ChronicleEvent[] = [];
    let dropLow = PURGE_BATCH;
    let dropMid = 0;
    for (const e of world.events) {
      if (dropLow > 0 && e.level === 0) { dropLow--; continue; }
      kept.push(e);
    }
    if (kept.length > MAX_EVENTS) {
      dropMid = kept.length - MAX_EVENTS;
      const kept2: ChronicleEvent[] = [];
      for (const e of kept) {
        if (dropMid > 0 && e.level === 1) { dropMid--; continue; }
        kept2.push(e);
      }
      world.events = kept2.slice(-MAX_EVENTS * 2);
    } else {
      world.events = kept;
    }
  }
}

/** 取最近的 N 条（新的在前） */
export function recentEvents(world: World, n: number): ChronicleEvent[] {
  const out: ChronicleEvent[] = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < n; i--) {
    out.push(world.events[i]);
  }
  return out;
}
