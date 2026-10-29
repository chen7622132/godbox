import { Rng } from '../core/rng';
import { RACES } from '../core/races';
import { logEvent } from '../core/events';
import { IS_LAND, type World } from '../core/types';
import { findLandNear } from '../core/world';
import { createSettlement } from './simulation';

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
      // 后 1/3 的尝试放宽地形要求，保证一定能落地
      const relaxed = tries > 600;
      const x = rng.int(world.w);
      const y = rng.int(world.h);
      const spot = findLandNear(world, x, y, 10, (i) => {
        const t = world.terrain[i];
        if (!IS_LAND[t]) return false;
        return relaxed ? true : def.pref.includes(t);
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
}
