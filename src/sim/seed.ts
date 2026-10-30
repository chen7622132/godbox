import { Rng } from '../core/rng';
import { RACES } from '../core/races';
import { logEvent } from '../core/events';
import { IS_LAND, T, type World } from '../core/types';
import { findLandNear } from '../core/world';
import { createSettlement } from './simulation';
import { spawnBeasts } from './beasts';

/**
 * 创世播种：给每个种族在偏好地形上放下若干个营地。
 * 4 个营地是个甜点值——太少不会建国，太多开局就挤成一团。
 */
export function seedRaces(
  world: World,
  raceIds: number[],
  perRace = 4,
  startPop = 26,
): void {
  const rng = new Rng((world.seed ^ 0x5bf03635) >>> 0);

  for (const race of raceIds) {
    const def = RACES[race];
    let placed = 0;
    let tries = 0;
    while (placed < perRace && tries < 900) {
      tries++;
      // 前 2/3 的尝试只认偏好地形，保证精灵落在森林、矮人落在山区；
      // 之后逐步放宽，避免某些族因为地图缺地形而一个都放不下
      const stage = tries < 600 ? 0 : 1;
      const x = rng.int(world.w);
      const y = rng.int(world.h);
      const spot = findLandNear(world, x, y, 10, (i) => {
        const t = world.terrain[i];
        if (!IS_LAND[t]) return false;
        if (stage === 1) return true;
        if (def.pref.includes(t)) return true;
        return def.buildHarsh && (t === T.Mountain || t === T.Snow);
      });
      if (spot < 0) continue;
      const sx = spot % world.w;
      const sy = (spot / world.w) | 0;
      let tooClose = false;
      for (const s of world.settlements) {
        if (Math.hypot(s.x - sx, s.y - sy) < 15) { tooClose = true; break; }
      }
      if (tooClose) continue;
      createSettlement(world, sx, sy, race, startPop, false);
      placed++;
    }

    if (placed > 0) {
      logEvent(world, 'gift', `神在世界的角落撒下了${def.name}的火种（${placed} 处）`, race, 2);
    } else {
      logEvent(world, 'gift', `${def.name}找不到立足之地（地图缺少适合的地形）`, race, 1);
    }
  }

  // 开场给一句定调，别让编年史头 10 分钟一片空白
  logEvent(
    world, 'gift',
    `纪元元年。${raceIds.map((r) => RACES[r].name).join('、')}的火种落地，历史开始流动`,
    -1, 2,
  );

  // 巨兽比所有文明都古老 —— 开局就放在荒野里
  spawnBeasts(world, 3);
}
