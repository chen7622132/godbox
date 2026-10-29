import { T } from './types';

export interface RaceDef {
  id: number;
  name: string;
  /** 单字简称，用于紧凑显示 */
  tag: string;
  /** 主色（UI 用，地图领土色另算） */
  color: string;
  /** 地图领土叠色 RGB */
  rgb: [number, number, number];
  /** 偏好的建城地形 */
  pref: number[];
  /** 人口增长系数 */
  growth: number;
  /** 战力系数 */
  power: number;
  /** 科研系数 */
  tech: number;
  /** 平均寿命（年） */
  lifespan: number;
  /** 基础侵略性 0-1 */
  aggression: number;
  /** 城市容量加成（对严苛地形的容忍） */
  harshness: number;
  nations: string[];
  cities: string[];
  given: string[];
  family: string[];
}

export const RACES: RaceDef[] = [
  {
    id: 0,
    name: '人类',
    tag: '人',
    color: '#e8c75f',
    rgb: [232, 199, 95],
    pref: [T.Grass, T.Sand, T.Forest],
    growth: 1.15,
    power: 1.0,
    tech: 1.15,
    lifespan: 62,
    aggression: 0.45,
    harshness: 1.0,
    nations: ['青阳', '赤霄', '玄戈', '紫宸', '长夏', '广陵', '云中', '昭武', '定远', '承平'],
    cities: ['安邑', '洛川', '临水', '青坪', '白鹿', '望云', '石桥', '长岭', '南坡', '铁溪',
      '稻香', '云梦', '苍梧', '平阳', '新丰', '陇西', '河东', '上郡', '朔方', '金城'],
    given: ['武', '昭', '承', '昱', '弘', '简', '肃', '襄', '宣', '景', '元', '怀', '定', '烈', '懿', '熙'],
    family: ['李', '赵', '韩', '楚', '燕', '秦', '魏', '田', '陈', '苏', '陆', '沈', '顾', '叶', '许', '高'],
  },
  {
    id: 1,
    name: '精灵',
    tag: '灵',
    color: '#8fe07f',
    rgb: [143, 224, 127],
    pref: [T.Forest, T.Snow, T.Grass],
    growth: 0.62,
    power: 1.32,
    tech: 1.05,
    lifespan: 240,
    aggression: 0.28,
    harshness: 0.7,
    nations: ['月华', '星语', '银叶', '翠庭', '风栖', '露冕', '碧隐', '长歌', '梦林', '素光'],
    cities: ['月泉', '星落', '翠谷', '银叶', '露华', '风眠', '碧隐', '翠薇', '萤溪', '雾林',
      '云杉', '白桦', '清泉', '林心', '苔庭', '玉兰', '初雪', '晨露', '星苔', '听风'],
    given: ['月', '星', '露', '霜', '风', '叶', '溪', 'languid', '琉', '白', '青', '羽', '岚', '雪', '瞳', '弦'],
    family: ['林', '叶', '星', '月', '风', '雪', '云', '露', '青', '白'],
  },
  {
    id: 2,
    name: '矮人',
    tag: '矮',
    color: '#d98f6a',
    rgb: [217, 143, 106],
    pref: [T.Hill, T.Mountain, T.Grass],
    growth: 0.72,
    power: 1.35,
    tech: 0.95,
    lifespan: 150,
    aggression: 0.35,
    harshness: 1.6,
    nations: ['铁砧', '深炉', '石心', '铜脊', '赤锤', '熔角', '黑岩', '沉脉', '九凿', '锻火'],
    cities: ['铁砧', '炉心', '深岩', '石脉', '金锤', '黑矿', '熔角', '铜脊', '沉岩', '赤炉',
      '锤谷', '凿壁', '铁门', '地听', '硬岩', '银脉', '火口', '石桥墩', '三锤', '深井'],
    given: ['铁', '石', '金', '锤', '炉', '岩', '铜', '斧', '钻', '锻', '深', '硬', '固', '矿', '凿', '焰'],
    family: ['铁', '石', '金', '铜', '岩', '锻', '锤', '脉'],
  },
  {
    id: 3,
    name: '兽人',
    tag: '兽',
    color: '#c2545f',
    rgb: [194, 84, 95],
    pref: [T.Grass, T.Swamp, T.Sand, T.Hill],
    growth: 1.18,
    power: 1.22,
    tech: 0.65,
    lifespan: 40,
    aggression: 0.68,
    harshness: 1.2,
    nations: ['血牙', '碎骨', '赤蛮', '荒吼', '獠牙', '焦土', '黑风', '骨堆', '狂沙', '断颚'],
    cities: ['碎骨', '血牙', '赤蛮', '荒原', '断吼', '獠牙', '焦土', '黑风', '骨堆', '狂沙',
      '裂颅', '烂泥', '嗷谷', '剥皮', '红石', '腐沼', '嚎林', '死水', '秃丘', '兽穴'],
    given: ['血', '牙', '骨', '吼', '獠', '煞', '狂', '裂', '凶', '蛮', '怒', '黑', '暴', '赤', '断', '咬'],
    family: ['血', '骨', '牙', '黑', '赤', '断', '狂', '凶'],
  },
];

export function raceOf(id: number): RaceDef {
  return RACES[id] ?? RACES[0];
}

/** 生成人名：人类/精灵用「姓+名」，矮人/兽人用「名+名」双字 */
export function makePersonName(
  rng: { pick: <X>(a: readonly X[]) => X },
  race: number,
): string {
  const r = raceOf(race);
  if (race === 0 || race === 1) {
    return rng.pick(r.family) + rng.pick(r.given);
  }
  return rng.pick(r.given) + rng.pick(r.given);
}
