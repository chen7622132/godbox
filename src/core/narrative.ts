/**
 * 叙事引擎 —— 把结构化的事件渲染成「史书语言」。
 *
 * 设计原则（借鉴矮人要塞的 Legends mode）：
 * 1. 每个事件必须绑定到具体的人，否则读者记不住；
 * 2. 每件事都要说清「因为什么」——因果链才产生博弈感；
 * 3. 同一件事有多种说法，随机取一种，保证每局不重样；
 * 4. 语体分两层：纪年体负责叙述，台词负责情绪。
 *
 * 注意：这里只有文字，不含任何规则。规则在 simulation.ts。
 */

export interface RngLike {
  next(): number;
}

// ============ 性格 ============

export const TRAITS = [
  '嗜血', '多疑', '仁厚', '贪婪', '刚愎', '隐忍',
  '狂傲', '谨慎', '好战', '尚智', '残暴', '重诺',
] as const;

/** 性格 → 宣战理由。这是「博弈感」的源头：他为什么打这一仗 */
const WAR_REASON: Record<string, string[]> = {
  嗜血: ['血债未偿，须以血偿', '此仇不报，何以立于天地'],
  多疑: ['彼将先发制人，不如我先动', '卧榻之侧，岂容他人鼾睡'],
  仁厚: ['彼民困于苛政，我当救之', '为天下苍生计，不得已而兴兵'],
  贪婪: ['彼之沃土，当属我国', '闻彼城中有金，可取之'],
  刚愎: ['彼曾辱我于众，此辱不可忍', '我意已决，勿复多言'],
  隐忍: ['忍之久矣，今日方得时机', '十年生聚，十年教训，今可一试'],
  狂傲: ['天下之地，何者不可取', '彼辈蝼蚁，一举可灭'],
  谨慎: ['彼渐强，不及早图之，后必为患', '此战虽险，然不战则危'],
  好战: ['刀剑久不饮血，已生锈了', '不战，则国中少年不知何为勇'],
  尚智: ['彼之内政已乱，可乘其隙', '用兵者贵在乘时，今其时也'],
  残暴: ['尽屠之，此地便归我有', '留其民为患，不如尽除'],
  重诺: ['盟友受欺，我若坐视，何以立信于天下', '我答应过出兵，便不能食言'],
};

/** 性格 → 战败后的反应（写进列传） */
const DEFEAT_REACTION = [
  '大怒，斩败将以示众',
  '默然良久，曰：「此我之过。」',
  '自此不再亲征',
  '尽收残兵，闭城不出，三年不闻鼓声',
  '大哭三日，此后须发尽白',
];

// ============ 绰号 ============

/** 按行事风格给的绰号 —— 一个人的名号，比他的真名更被记住 */
const EPITHET_BY_TRAIT: Record<string, string[]> = {
  嗜血: ['血手', '屠夫', '赤刃'],
  多疑: ['暗眼', '影王', '不眠者'],
  仁厚: ['慈主', '安民者', '众人之父'],
  贪婪: ['金牙', '聚敛者', '守财王'],
  刚愎: ['铁颈', '不低头者', '孤行者'],
  隐忍: ['默者', '长夜之王', '伏蛇'],
  狂傲: ['无冕者', '天骄', '目中无人者'],
  谨慎: ['磐石', '老谋', '守成之君'],
  好战: ['铁蹄', '破城者', '常胜'],
  尚智: ['白眉', '智者', '执棋人'],
  残暴: ['暴君', '焚城者', '无恩者'],
  重诺: ['守信者', '一言', '旧约'],
};

/** 战功换来的绰号 */
const EPITHET_BY_DEED = {
  conqueror: ['大帝', '万城之王', '四方共主'],
  slayer: ['万人屠', '尸山', '血河之主'],
  survivor: ['不死者', '三劫余生', '顽石'],
  founder: ['开国之君', '立基者', '第一人'],
};

// ============ 台词 ============

/**
 * 台词按「性格阵营」分组。
 * 同一个人一辈子说话风格应该是一致的 —— 鹰派不会说鸽派的话。
 */
const HAWKS = ['嗜血', '好战', '残暴', '狂傲', '刚愎'];
const DOVES = ['仁厚', '谨慎', '重诺'];

const QUOTE_BY_CAMP = {
  hawk: {
    war: [
      '「刀已出鞘，便无回头之理。」',
      '「让他们记住这一天。」',
      '「我此去，或为尘土。然不去，则永为尘土。」',
      '「不战，则国中少年不知何为勇。」',
    ],
    win: [
      '「看，这就是不降的下场。」',
      '「我非好杀，然此城挡了我的路。」',
      '「今日之后，此地当无旧名。」',
      '「他们守了三十天。值得敬一杯。」',
    ],
    die: [
      '「我这一生，够了。」',
      '「把剑给孩子……别让他忘了。」',
      '「我杀过很多人。现在轮到我了。」',
      '「史官在旁么？写：我曾来过。」',
    ],
  },
  dove: {
    war: [
      '「我不想打这一仗，但我必须打。」',
      '「为了活着的人，我只能让一些人死。」',
      '「若我今日退，明日便是我的城。」',
      '「愿这是最后一场。」',
    ],
    win: [
      '「城已破。把伤者都抬进来，不分敌我。」',
      '「我不想再看第二座这样的城。」',
      '「胜了。可是少了这么多人，算什么胜。」',
      '「今天的酒，敬活着的人。」',
    ],
    die: [
      '「勿为我报仇，会死更多人的。」',
      '「我尽力了。真的。」',
      '「把城门开着吧，别让人再翻墙进来。」',
      '「我以为我能护住所有人。」',
    ],
  },
  cunning: {
    war: [
      '「此战之后，史书当如何写我？」',
      '「我算过了。他会先动。」',
      '「不必打赢。只要他输。」',
      '「让他们以为是自己想打的。」',
    ],
    win: [
      '「我说过，他会先动。」',
      '「城是死的，人是活的。我要的是人。」',
      '「这一局，我下了二十年。」',
      '「胜之不武？史书只记胜。」',
    ],
    die: [
      '「原来死是这样，早知如此。」',
      '「我还有一子未落……」',
      '「他们终于赢了。也好。」',
      '「别信那个盟约。会有人背的。」',
    ],
  },
};

function campOf(traits: string[]): 'hawk' | 'dove' | 'cunning' {
  if (traits.some((t) => HAWKS.includes(t))) return 'hawk';
  if (traits.some((t) => DOVES.includes(t))) return 'dove';
  return 'cunning';
}

const QUOTES = {
  heir: [
    '「父之仇，子当报。」',
    '「我不如他。但我会活得比他久。」',
    '「他留下的是一个国，还是一堆债？」',
    '「先王未竟之业，今日当续。」',
    '「我只想让这一代孩子不用上战场。」',
  ],
  peace: [
    '「够了。死的人已经够多了。」',
    '「今日握手，明日未必。」',
    '「我签这个字，是因为我打不下去了。」',
    '「让他们骂我吧。城还在。」',
  ],
};

// ============ 工具 ============

const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 数字 → 中文（够用的范围即可） */
export function cnNum(n: number): string {
  const v = Math.round(Math.abs(n));
  if (v < 10) return CN_NUM[v];
  if (v < 20) return '十' + (v % 10 ? CN_NUM[v % 10] : '');
  if (v < 100) return CN_NUM[Math.floor(v / 10)] + '十' + (v % 10 ? CN_NUM[v % 10] : '');
  if (v < 1000) {
    const h = Math.floor(v / 100);
    const r = v % 100;
    let s = CN_NUM[h] + '百';
    if (r >= 10) s += (r >= 20 ? CN_NUM[Math.floor(r / 10)] : '') + '十' + (r % 10 ? CN_NUM[r % 10] : '');
    else if (r > 0) s += '零' + CN_NUM[r];
    return s;
  }
  if (v < 10000) {
    const t = Math.floor(v / 1000);
    const r = v % 1000;
    let s = CN_NUM[t] + '千';
    if (r >= 100) s += cnNum(r);
    else if (r > 0) s += '零' + cnNum(r);
    return s;
  }
  const w = Math.floor(v / 10000);
  const r = v % 10000;
  return cnNum(w) + '万' + (r > 0 ? cnNum(r) : '');
}

/** 大数量级的模糊说法，史诗感靠这个 */
export function grandNum(n: number): string {
  if (n < 10) return cnNum(n) + '人';
  if (n < 100) return '数十人';
  if (n < 600) return cnNum(Math.round(n / 100) * 100) + '余人';
  if (n < 1000) return '近千人';
  if (n < 10000) return cnNum(Math.round(n / 1000)) + '千余人';
  return cnNum(Math.round(n / 10000)) + '万余人';
}

// ============ 渲染器 ============

export class Narrator {
  constructor(private rng: RngLike) {}

  private one<T>(a: readonly T[]): T {
    return a[Math.floor(this.rng.next() * a.length) % a.length];
  }

  /** 抽 2 个性格 */
  rollTraits(): string[] {
    const pool = [...TRAITS];
    const a = pool.splice(Math.floor(this.rng.next() * pool.length), 1)[0];
    const b = pool.splice(Math.floor(this.rng.next() * pool.length), 1)[0];
    return [a, b];
  }

  /** 宣战理由 */
  warReason(traits: string[]): string {
    const t = traits[Math.floor(this.rng.next() * traits.length)] ?? '好战';
    return this.one(WAR_REASON[t] ?? WAR_REASON['好战']);
  }

  /** 记住上一句，避免连续重复 */
  private lastQuote = '';

  private nq(pool: readonly string[]): string {
    for (let i = 0; i < 6; i++) {
      const q = this.one(pool);
      if (q !== this.lastQuote) {
        this.lastQuote = q;
        return q;
      }
    }
    return this.one(pool);
  }

  warQuote(traits: string[] = []): string {
    return this.nq(QUOTE_BY_CAMP[campOf(traits)].war);
  }

  victoryQuote(traits: string[] = []): string {
    return this.nq(QUOTE_BY_CAMP[campOf(traits)].win);
  }

  deathQuote(traits: string[] = []): string {
    return this.nq(QUOTE_BY_CAMP[campOf(traits)].die);
  }

  defeatQuote(): string {
    return this.nq([
      '「非战之罪，天亡我也。」',
      '「我负了那些跟我出城的人。」',
      '「退。此仇记下。」',
      '「我以为我算得够准了。」',
      '「原来他们的城墙比我想的厚。」',
    ]);
  }

  heirQuote(): string {
    return this.nq(QUOTES.heir);
  }

  peaceQuote(): string {
    return this.nq(QUOTES.peace);
  }

  defeatReaction(): string {
    return this.one(DEFEAT_REACTION);
  }

  /**
   * 按「实际做了什么」给绰号 —— 不能按性格乱给。
   * 一个从没打过仗的人被叫「屠夫」，整篇列传就假了。
   */
  epithet(
    traits: string[],
    stats: { citiesTaken: number; popSlain: number; warsWon: number; warsLost: number; reign: number },
  ): string {
    if (stats.citiesTaken >= 5) return this.one(EPITHET_BY_DEED.conqueror);
    if (stats.popSlain >= 6000) return this.one(EPITHET_BY_DEED.slayer);
    if (stats.warsWon >= 4) return this.one(EPITHET_BY_DEED.survivor);
    if (stats.citiesTaken >= 2) return this.one(EPITHET_BY_DEED.founder);
    // 一辈子没动刀兵的人，名号就该是安静的
    if (stats.warsWon + stats.warsLost === 0) {
      return this.one(stats.reign > 40
        ? ['长平之君', '不动之君', '缄默者', '安坐者']
        : ['无闻者', '守成之君', '平常之主']);
    }
    const t = traits[0] ?? '好战';
    const pool = EPITHET_BY_TRAIT[t];
    if (pool) return this.one(pool);
    return '无名者';
  }

  /** 守方击退（变体多，避免同一句话反复出现） */
  defenseText(defKing: string, defNation: string, atkKing: string, atkNation: string, city: string): string {
    return this.nq([
      `${defKing} 坚守 ${city}，${atkKing} 攻三日不克，退兵。`,
      `${city} 城下，${atkKing} 折兵而还，${defKing} 之名由是大振。`,
      `${atkKing} 攻 ${city}，${defKing} 出城逆击，${atkNation} 军大溃。`,
      `${atkNation} 围 ${city} 二百日，城中食尽而不降。${atkKing} 引去。`,
      `${city} 之战，${defNation} 以少击众，${atkNation} 弃甲而走。`,
    ]);
  }

  /** 宣战（纪年体正文） */
  warText(atk: string, atkKing: string, def: string, defKing: string, reason: string): string {
    return `${atk} 之王 ${atkKing} 举兵伐 ${def}，檄曰：${reason}。${def} 之王 ${defKing} 闻之，尽发国中丁壮。`;
  }

  /** 战役 */
  battleText(winner: string, winnerKing: string, loser: string, city: string, slain: number): string {
    const s = grandNum(slain);
    return `${winnerKing}（${winner}）与敌战于 ${city} 城下，大破之，斩 ${s}。`;
  }

  /** 攻陷 */
  conquerText(king: string, nation: string, city: string, slain: number): string {
    const s = grandNum(slain);
    return `${king} 拔 ${city}。城破之日，屠 ${s}，血流至城外三里。`;
  }

  /** 死亡 */
  deathText(name: string, age: number, cause: string, epithet: string): string {
    return `${name}${epithet ? `（${epithet}）` : ''}${cause}，年 ${cnNum(age)}。`;
  }

  /** 加冕 */
  coronationText(name: string, nation: string, father: string | null): string {
    if (father) return `${father} 之子 ${name} 即位，是为 ${nation} 新主。`;
    return `${name} 立为 ${nation} 之主，改元。`;
  }

  /** 血债事件 */
  feudText(nation: string, target: string, dead: number): string {
    return `${nation} 举国戴孝，记 ${target} 血债 ${grandNum(dead)} 于宗庙。`;
  }

  /** 复仇战争 */
  revengeText(king: string, nation: string, target: string, dead: number): string {
    return `${king} 誓师：「${target} 负我 ${grandNum(dead)} 条命，今当尽偿。」三军皆哭，遂发兵。`;
  }

  /** 时代卷首语 */
  eraOpening(era: number, notable: string): string {
    const opts = [
      `第 ${cnNum(era + 1)} 卷 —— 是时，${notable} 之名，四野皆闻。`,
      `第 ${cnNum(era + 1)} 卷 —— 天下之势，因 ${notable} 而变。`,
      `第 ${cnNum(era + 1)} 卷 —— 后人论此世，必称 ${notable}。`,
    ];
    return this.one(opts);
  }

  /** 卷末史评（史记「太史公曰」的位置） */
  eraComment(count: number): string {
    const n = cnNum(Math.max(1, Math.round(count)));
    return this.one([
      `史官曰：此一卷间，大事 ${n} 件。兴者未必有德，亡者未必无义。`,
      `史官曰：观此一世，兵连祸结，凡 ${n} 事可记。后人读之，当知今日之不易。`,
      `史官曰：此卷凡 ${n} 事。胜者书其功，败者书其名，如此而已。`,
      `史官曰：天下大势，分久必合。此卷 ${n} 事，不过其中一页。`,
    ]);
  }
}
