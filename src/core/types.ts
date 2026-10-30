/**
 * 全局类型与常量。所有模拟子系统都从这里取类型。
 */

// ============ 地形 ============
export const T = {
  Deep: 0,
  Water: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Hill: 5,
  Mountain: 6,
  Snow: 7,
  Swamp: 8,
  Ruin: 9,
} as const;
export type TerrainId = (typeof T)[keyof typeof T];

/** 是否陆地 */
export const IS_LAND: boolean[] = [false, false, false, true, true, true, true, true, true, true];
/** 是否可建城（山地只有矮人能建，逻辑里另判） */
export const BUILDABLE: boolean[] = [false, false, false, true, true, true, false, false, true, true];

export const TERRAIN_NAME: string[] = [
  '深海', '浅海', '沙滩', '草原', '森林', '丘陵', '山地', '雪原', '沼泽', '废墟',
];

// ============ 时间 ============
/**
 * 每 tick 推进多少「世界年」。
 * 9000 tick 的一局 ≈ 900 年历史 —— 够演 15~20 代王朝，
 * 又不至于让国王每十秒换一个（那样编年史就变成讣告流水账）。
 */
export const YEARS_PER_TICK = 0.1;

/** 每秒模拟 tick 数（与渲染帧率解耦） */
export const SIM_HZ = 10;
/** 可选的倍速档 */
export const SPEEDS = [0, 1, 2, 4, 8];

// ============ 规模档位 ============
export const WORLD_SIZES = {
  small: { w: 160, h: 120, label: '小世界 160×120' },
  medium: { w: 256, h: 192, label: '中世界 256×192' },
  large: { w: 384, h: 288, label: '大世界 384×288' },
} as const;
export type WorldSizeKey = keyof typeof WORLD_SIZES;

// ============ 聚落 ============
export const TIER_NAME = ['营地', '村庄', '城镇', '城市', '都城'];
/** 每级所需人口 */
export const TIER_POP = [0, 30, 90, 220, 500];

// ============ 国家 ============
export const TECH_NAME = [
  '无', '部落制', '农耕', '青铜', '铁器', '王国', '帝国',
];
/** 科技等级对应的战力系数 */
export const TECH_POWER = [1, 1, 1.15, 1.35, 1.6, 1.9, 2.3];

// ============ 事件 ============
export type EventKind =
  | 'found'    // 建城
  | 'grow'     // 升级为城镇/城市
  | 'nation'   // 建国
  | 'coronate' // 加冕
  | 'death'    // 国王/英雄死亡
  | 'tech'     // 科技突破
  | 'war'      // 宣战
  | 'battle'   // 战役
  | 'conquer'  // 攻陷
  | 'peace'    // 议和
  | 'disaster' // 灾难
  | 'plague'   // 瘟疫
  | 'gift'     // 神迹
  | 'extinct'  // 种族灭绝
  | 'unify'    // 统一
  | 'ruin'     // 城市毁灭
  | 'betray'   // 背叛/倒戈
  | 'revolt'   // 叛乱
  | 'feud'     // 恩怨
  | 'legend';  // 传奇（英雄崛起、奇观）

export interface ChronicleEvent {
  year: number;
  kind: EventKind;
  text: string;
  /** 用于着色的种族 id，-1 = 中立（灾难等） */
  race: number;
  /** 重要性 0-2，2 = 大事（战争/统一），用于筛选 */
  level: number;
  /** 主角（人名），用于列传索引 */
  actor?: string;
  /** 这条事件的「因」——让编年史读起来有因果链 */
  cause?: string;
  /** 一句台词（按情况随机挑） */
  quote?: string;
  /** 时代卷号 */
  era?: number;
}

// ============ 聚落 ============
/** 情绪 4 档，由「进食结果」链式推导（WorldBox 规则） */
export type MoodState = 'happy' | 'normal' | 'sad' | 'angry';

/** 食物种类 */
export const FOOD = { Grain: 0, Fish: 1, Berry: 2, Meat: 3 } as const;
export const FOOD_NAME = ['谷物', '鱼获', '野果', '兽肉'];

/** 头顶可见状态 */
export type StatusKind =
  | 'sing'      // 唱歌：白色音符
  | 'laugh'     // 大笑：白色笑脸
  | 'curse'     // 咒骂：红色井号
  | 'cry'       // 哭泣：蓝色水滴
  | 'tantrum'   // 发脾气：砸房子
  | 'love'      // 坠入爱河：粉色心
  | 'sleep';    // 睡眠：横线

export interface Settlement {
  id: number;
  x: number;
  y: number;
  race: number;
  nation: number; // -1 = 独立部落
  pop: number;
  cap: number;
  tier: number; // 0..4
  founded: number; // 建城年份
  walls: number; // 城墙等级 0-3
  food: number; // 0..1 食物储备
  alive: boolean;
  name: string;
  garrison: number;
  ruin: boolean;
  capital: boolean;
  /** 上次派移民建新城的 tick */
  lastSpawn: number;

  // ---- 情绪系统（WorldBox 式：食物决定情绪，情绪决定行为）----
  /** 情绪档位 */
  mood: MoodState;
  /** 幸福度 -100..100 */
  happiness: number;
  /** 本城实际能吃到的食物（由周边地形推导） */
  foodKind: number;
  /** 该族最爱的食物 */
  favFood: number;
  /** 每次进食触发情绪推演 */
  lastMeal: number;
  /** 当前可见状态 */
  status: StatusKind | null;
  /** 状态到期 tick */
  statusUntil: number;
  /** 连续处于负面情绪的时长（用于触发叛乱） */
  miseryTicks: number;
  /** 房屋破损度 0..1（发脾气砸出来的） */
  damage: number;
}

// ============ 国家 ============
export interface Nation {
  id: number;
  race: number;
  name: string;
  color: string;
  capital: number; // settlement id
  cities: number[];
  tech: number; // 1..6
  techProgress: number;
  king: number; // agent id
  founded: number;
  alive: boolean;
  enemies: number[]; // nation ids
  aggression: number;
  warsWon: number;
  warsLost: number;
  peakPop: number;
  /** 上次发兵 tick */
  lastCampaign: number;
  /** 当前战争的开始 tick（用于判断战争是否够久） */
  warSince: number;

  // ---- 博弈层（v1.5）----
  /** 对每个国家的血债，索引 = 对方国家 id，值 = 累计被杀人口 */
  grudge: number[];
  /** 国策：决定它这几百年想干什么 */
  doctrine: Ambition;
  /** 王朝名（第一个王的名字 + 家族） */
  dynasty: string;
  /** 建国以来的战争数 */
  warCount: number;
  /** 是否已经分裂过 */
  fractured: boolean;
  /** 同盟国 id（联姻结盟） */
  allies: number[];
  /** 同盟在双方哪一位君主死后失效 */
  allyKingA: number;
  allyKingB: number;
  /** 盟约到期年份（人死约不必死，但有期限） */
  allyUntil: number;
  /** 背叛次数 */
  betrayals: number;
}

// ============ 有名个体 ============
/** 执念：决定这个君主这一辈子在干什么 */
export type Ambition = 'conquer' | 'revenge' | 'glory' | 'peace' | 'wealth';

export const AMBITION_NAME: Record<Ambition, string> = {
  conquer: '一统天下',
  revenge: '血债血偿',
  glory: '名垂青史',
  peace: '守土安民',
  wealth: '富国强兵',
};

/** 一条事迹（列传的最小单位） */
export interface Deed {
  year: number;
  text: string;
  /** 1 = 值得写进列传，2 = 传奇级 */
  weight: number;
}

/**
 * 一个有名有姓的人物。矮人要塞的核心是「历史事件绑定到人」，
 * 所以这里不是 id 表，而是能被反查一生的档案。
 */
export interface Agent {
  id: number;
  name: string;
  race: number;
  nation: number;
  role: 'king' | 'general';
  born: number;
  age: number;
  lifespan: number;
  /** 个人能力 0.7–1.6 */
  talent: number;
  alive: boolean;

  // ---- 人物档案 ----
  /** 绰号，由行事作风在中年时获得 */
  epithet: string;
  /** 性格标签，直接影响决策倾向 */
  traits: string[];
  /** 执念 */
  ambition: Ambition;
  /** 父（用于世系与复仇） */
  father: number | null;
  /** 被哪个国家所杀（-1 无） */
  killedBy: number;
  /** 宿敌（人物 id，-1 无） */
  nemesis: number;
  /** 战绩 */
  warsWon: number;
  warsLost: number;
  citiesTaken: number;
  citiesLost: number;
  popSlain: number;
  citiesFounded: number;
  /** 在位年数 */
  reign: number;
  /** 事迹流（列传直接由它拼出来） */
  deeds: Deed[];
  /** 死因 */
  cause: string | null;
  /** 谥号（死后一字定评） */
  posthumous: string;
  /** 死于哪一年 */
  diedYear: number | null;
}

// ============ 全局统计 ============
export interface Stats {
  warsDeclared: number;
  battles: number;
  citiesFounded: number;
  citiesDestroyed: number;
  disasters: number;
  /** 玩家使用神迹（赐福类）次数 */
  gifts: number;
  peakPop: number;
  /** 各族峰值人口 */
  racePeak: number[];
  /** 各族人口历史采样 [tick, pop] 每 30 tick 一个 */
  popHistory: number[][];
}

// ============ 世界 ============
/**
 * 远古巨兽。矮人要塞里最强的叙事引擎：
 * 一只巨兽能凭一己之力逼文明放弃城镇，也会成就「屠兽英雄」。
 * 它打破单一文明的滚雪球，又天然产出史诗。
 */
export interface Beast {
  id: number;
  name: string;
  /** 0 巨兽（强） / 1 魔兽（中） */
  tier: number;
  x: number;
  y: number;
  /** 战力：能压倒中等城池，但会被大国的主力击退 */
  power: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 累计杀了多少人 */
  kills: number;
  /** 毁掉了几座城 */
  razed: number;
  /** 上次行动 tick */
  lastAct: number;
  /** 上次出现的年份（用于「蛰伏十年后重现」） */
  lastSeen: number;
  /** 杀了它的人（agent id，-1 无） */
  slainBy: number;
}

/**
 * 世界奇观。全球唯一，先建成者得 —— 这是《文明6》制造史诗的核心：
 * 它把「发展」变成一场可见的竞赛，而且建造中的城邦极脆弱（「奇观误国」）。
 */
export interface Wonder {
  /** 0 人类 / 1 精灵 / 2 矮人 / 3 兽人 */
  kind: number;
  name: string;
  /** 建造国（-1 = 未开工） */
  nation: number;
  /** 所在城 */
  city: number;
  /** 0..1 */
  progress: number;
  built: boolean;
  /** 开工年份 */
  started: number;
  /** 完工年份 */
  finished: number;
  /** 是否半途而废（城破 / 国亡） */
  ruined: boolean;
}

/** 市民职业 */
export type Job = 'farmer' | 'wood' | 'mine' | 'soldier' | 'priest' | 'child';

/** 一个真实存在于地图上的个体 */
export interface Unit {
  id: number;
  race: number;
  job: Job;
  nation: number;
  /** 所属城池 */
  home: number;
  x: number;
  y: number;
  /** 目标点 */
  tx: number;
  ty: number;
  state: 'idle' | 'walk' | 'work' | 'fight';
  timer: number;
  /** 动画帧计数（走路摆腿用） */
  anim: number;
  hp: number;
  /** 朝向 0下 1左 2右 3上 */
  dir: number;
}

export interface World {
  w: number;
  h: number;
  // ---- 网格层 ----
  terrain: Uint8Array;
  fert: Uint8Array; // 肥沃度 0-255
  owner: Int32Array; // 聚落 id，-1 无主
  nationOf: Int16Array; // 国家 id，-1 无
  fire: Uint8Array; // 火强度
  plague: Uint8Array; // 瘟疫强度
  // ---- 全局状态 ----
  seed: number;
  rngState: number;
  year: number;
  tick: number;
  // ---- 实体 ----
  settlements: Settlement[];
  nations: Nation[];
  agents: Agent[];
  beasts: Beast[];
  wonders: Wonder[];
  units: Unit[];
  battles: { attackers: number[]; defenders: number[]; x: number; y: number; until: number; loserNation: number }[];
  events: ChronicleEvent[];
  stats: Stats;
  // ---- 流程 ----
  ended: boolean;
  endReason: string;
  /** 已触发过的种族灭绝（避免重复播报） */
  extincted: boolean[];
  /** 快速跳过：场上是否有火 / 瘟疫（读档时重建） */
  hasFire: boolean;
  hasPlague: boolean;
  /** 玩家选择「回到这个世界」继续观察，不再自动结算 */
  overtime: boolean;
}

// ============ 工具 ============
export type ToolId =
  | 'inspect'
  | 'terra_grass' | 'terra_forest' | 'terra_mountain' | 'terra_water' | 'terra_sand'
  | 'spawn_human' | 'spawn_elf' | 'spawn_dwarf' | 'spawn_orc'
  | 'bless_fert' | 'bless_heal' | 'bless_tech'
  | 'dis_fire' | 'dis_plague' | 'dis_quake' | 'dis_meteor' | 'dis_flood'
  | 'kill';

export interface IdCounter {
  next: number;
}
