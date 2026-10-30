import type { World, ChronicleEvent } from './types';
import { cnNum, grandNum } from './narrative';

/**
 * 史书生成器 —— 第二版。
 *
 * 第一版的错：只堆氛围模板，六卷里「最后一支守军」出现了六次。
 * 那比流水账更假，因为读者一眼看出是填空。
 *
 * 这一版的核心改动是「先立因，再写果」：
 *   每卷开头先找一笔账（记仇 / 血债 / 背盟），把它写成这卷的引子；
 *   后面的亡国、屠城、奇观，都挂在这笔账下面。
 * 因果不是形容词堆出来的，是模拟层真的记了那笔账 —— 这里只是把它读出来。
 *
 * 文风硬约束（对齐用户给的规则）：
 *   · 不从年份开场，从具体瞬间/具体的人切入
 *   · 每段至少两种感官（天气 + 声音）
 *   · 结尾不升华，留一个未完成的动作
 *   · 事实锚点（国名、城名、年份、结果）一律照抄事件原文，不改写
 */

export type TurnKind = 'fall' | 'slay' | 'betray' | 'wonder' | 'beast' | 'fracture' | 'rise' | 'debt';

export interface Turn {
  kind: TurnKind;
  year: number;
  weight: number;
  ev: ChronicleEvent;
}

export interface Chapter {
  index: number;
  title: string;
  lines: string[];
}

const KIND_WEIGHT: Record<TurnKind, number> = {
  rise: 100,
  fall: 92,
  debt: 88,
  slay: 70,
  betray: 66,
  beast: 60,
  fracture: 55,
  wonder: 48,
};

function classify(e: ChronicleEvent): Turn | null {
  const y = e.year;
  if (e.kind === 'unify') return { kind: 'rise', year: y, weight: KIND_WEIGHT.rise, ev: e };
  if (e.kind === 'extinct') return { kind: 'fall', year: y, weight: KIND_WEIGHT.fall, ev: e };
  // 记仇/复仇/继承血债 —— 这是「因」，权重仅次于亡国
  if (e.kind === 'feud') return { kind: 'debt', year: y, weight: KIND_WEIGHT.debt, ev: e };
  if (e.kind === 'betray') return { kind: 'betray', year: y, weight: KIND_WEIGHT.betray, ev: e };
  if (e.kind === 'conquer') return { kind: 'slay', year: y, weight: KIND_WEIGHT.slay, ev: e };
  if (e.kind === 'disaster' && /盘踞|破 /.test(e.text)) return { kind: 'beast', year: y, weight: KIND_WEIGHT.beast, ev: e };
  if (e.kind === 'revolt' && /裂为二/.test(e.text)) return { kind: 'fracture', year: y, weight: KIND_WEIGHT.fracture, ev: e };
  if (e.kind === 'legend' && /落成/.test(e.text)) return { kind: 'wonder', year: y, weight: KIND_WEIGHT.wonder, ev: e };
  return null;
}

export function findTurns(world: World): Turn[] {
  const out: Turn[] = [];
  const seen = new Set<ChronicleEvent>();
  for (const e of world.events) {
    if (seen.has(e)) continue;
    const t = classify(e);
    if (t) {
      seen.add(e);
      out.push(t);
    }
  }
  return out;
}

// ---------- 文风零件：每类至少 5 套，按种子取，避免一眼看出填空 ----------

const WEATHER = [
  '雨下了三天，泥水没过脚踝',
  '风从北边来，带着焦味和灰',
  '天光灰白，像蒙了一层脏布',
  '日头毒得人睁不开眼，铁甲烫手',
  '雪落下来，落在血上就化了',
  '夜里有雾，火把只照出两步远',
  '河面结了薄冰，一踩就碎',
  '空气里有铁锈味，说不清是兵器还是血',
];

const SOUND = [
  '远处有人在哭，也有人笑',
  '只听得见自己喘气的声音',
  '号角吹了一半就断了',
  '兵器碰撞声停了一下，然后更密',
  '有人在喊一个人的名字，没人应',
  '鼓声一直没停，直到天亮',
  '孩子在墙根唱歌，唱错了好几处',
  '铁砧敲了一夜，一声比一声慢',
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(Math.floor(seed)) % arr.length];
}

/** 把事件原文里的事实锚点原样取出，只去掉句号与多余空白 */
function fact(s: string): string {
  return s.replace(/。\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** 事件里的人名/国名，用于纪传体的「谁」 */
function who(ev: ChronicleEvent): string {
  if (ev.actor) return ev.actor;
  const m = fact(ev.text).match(/^([^\s，。「」]+)/);
  return m ? m[1] : '有人';
}

// ---------- 各类转折点的场景 ----------

function sceneDebt(t: Turn, w: World, s: number): string[] {
  const ev = t.ev;
  const name = who(ev);
  const cause = ev.cause ? fact(ev.cause) : '一笔没人记得起因的账';
  return [
    `${pick(WEATHER, s)}。${name} 那天没有睡。案上摊着一张旧图，图上有一个已经不属于他的城。`,
    `这笔账记的是：${cause}。他没有说要用多少年去还，只说了一句 —— 于是后来所有的仗，都有了由头。`,
  ];
}

function sceneFall(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  const name = txt.replace(/覆灭.*$/, '').trim() || '这一族';
  const variants = [
    [
      `${pick(WEATHER, s)}。${name} 的最后一个城门是从里面被推开的 —— 守军已经没力气拉门闩了。`,
      `${pick(SOUND, s + 3)}。${fact(txt)}。国玺沉进井底 —— 因为从这一夜起，再没有谁需要它盖印了。`,
    ],
    [
      `最后一夜，${name} 的史官焚了档。火光照着墙上一排排空架，${pick(SOUND, s + 2)}。`,
      `${fact(txt)}。因为没人教书了，留下来的只有几个地名，和一句「从前这里不是这样」。`,
    ],
    [
      `${pick(WEATHER, s + 5)}。${name} 的王在城破前一刻还在等援军。援军没有来。`,
      `${fact(txt)}。此后出生的孩子，不会知道这个国号该怎么念。`,
    ],
    [
      `城墙塌的那一段只有三丈宽，但足够了。${fact(txt)}。`,
      `${pick(SOUND, s + 4)}。有人脱下甲，混进人群里走掉了 —— 活着的人总要有个去处。`,
    ],
    [
      `${name} 的末代王没有逃。他把冠放在案上，然后坐下了。`,
      `${pick(WEATHER, s + 1)}。${fact(txt)}。这一天，边界的走向被重新画了一遍。`,
    ],
  ];
  return pick(variants, s);
}

function sceneSlay(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  const hit = txt.match(/屠\s*([^，。]+)/);
  const dead = hit ? hit[1] : null;
  const variants = [
    [
      `${pick(WEATHER, s + 1)}。${txt}。`,
      `${pick(SOUND, s + 5)}。${dead ? `这一场下来，${dead}再没站起来。` : '这一场下来，账又厚了一页。'}`,
    ],
    [
      `${txt} 的消息传到后方时，天刚亮。${pick(SOUND, s + 2)}。`,
      `活着回来的人不多，回来的那些，往后很多年不提这一仗。`,
    ],
    [
      `城破之前，守将把家眷送了出去，自己留下。${txt}。`,
      `${pick(WEATHER, s + 6)}。这笔血债被记在胜者的名下，也记在败者的后代心里。`,
    ],
    [
      `${pick(WEATHER, s + 3)}。${txt}。街上的门一扇扇被踹开，又一扇扇安静下来。`,
      `${pick(SOUND, s + 7)}。因为活着的人还要吃饭，三天后这座城照常开市 —— 只是换了个收税的人。`,
    ],
    [
      `${txt}。这不是第一次，也不是最后一次。`,
      `有意思的是：下令的人当晚睡得很少。${pick(SOUND, s + 1)}。`,
    ],
  ];
  return pick(variants, s);
}

function sceneBetray(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  return pick([
    [
      `盟书上的墨还没干透，就有人开始算另一笔账了。${txt}。`,
      `${pick(SOUND, s + 2)}。使者还在路上，前锋已经抵到城下。这一页最难解释。`,
    ],
    [
      `两个王曾经同席饮过酒，用的是同一只杯子。${txt}。`,
      `${pick(WEATHER, s + 4)}。背盟的人因此赢了很久，很久之后才输。`,
    ],
    [
      `${txt}。消息传到盟国时，那边正在办喜事。`,
      `${pick(SOUND, s + 6)}。喜事照办完了。只是那天没人敬酒。`,
    ],
  ], s);
}

function sceneBeast(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  return pick([
    [
      `${pick(WEATHER, s + 4)}。${txt}。`,
      `没人知道它从哪来。人们只知道，此后出城要结伴，夜里不点灯。`,
    ],
    [
      `起初只是牲口少了。后来是牧人。再后来，是整座城空了。${txt}。`,
      `${pick(SOUND, s + 3)}。有胆子大的去看过，回来说：地上有印子，比门板大。`,
    ],
    [
      `${txt}。那一夜，城里的钟自己响了。`,
      `${pick(WEATHER, s + 7)}。第二年的春耕，有三分之一的田没人去。`,
    ],
  ], s);
}

function sceneWonder(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  return pick([
    [
      `${txt}。最后一块石头落位那天，工匠们没有欢呼，只是坐下来喘气。`,
      `修它的人多半已经不在了 —— 三代人，只为让某样东西比自己活得久。`,
    ],
    [
      `${pick(WEATHER, s + 2)}。${txt}。`,
      `${pick(SOUND, s + 8)}。有人从千里外赶来，只为了摸一下最外层的石头。`,
    ],
    [
      `${txt}。国库为此空了两年，第二年有人饿死。`,
      `史官照实记了这两件事，没有评判 —— 评判留给后面的人。`,
    ],
  ], s);
}

function sceneFracture(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  return pick([
    [
      `${pick(WEATHER, s + 7)}。${txt}。`,
      `京城来的命令到这里，已经晚了三个月。边地的人等不起，于是他们不再等了。`,
    ],
    [
      `${txt}。两边的旗长得几乎一样，只是绣的字不同。`,
      `${pick(SOUND, s + 5)}。兄弟在城门口对峙了半个时辰，谁也没先动手，最后是一支箭替他们做了决定。`,
    ],
    [
      `分裂往往不是因为恨，而是因为路太远。${txt}。`,
      `${pick(WEATHER, s + 3)}。所以此后两百年的边境纠纷，都能回溯到这一天。`,
    ],
  ], s);
}

function sceneRise(t: Turn, w: World, s: number): string[] {
  const txt = fact(t.ev.text);
  return pick([
    [
      `${txt}。旗号只剩一种颜色。`,
      `${pick(SOUND, s + 8)}。史官写到这里停了很久 —— 再往下，就没有「别国」可记了。`,
    ],
    [
      `最后一座城开门的时候，没有抵抗。${txt}。`,
      `${pick(WEATHER, s + 1)}。收降的将军问了一句：还有别的旗吗。没人回答。`,
    ],
    [
      `${txt}。这一天被记了下来，但没人知道该高兴还是难过。`,
      `${pick(SOUND, s + 4)}。街上有人放了一夜的火，不知是庆贺还是烧东西。`,
    ],
  ], s);
}

const SCENE_FN: Record<TurnKind, (t: Turn, w: World, s: number) => string[]> = {
  fall: sceneFall,
  slay: sceneSlay,
  betray: sceneBetray,
  beast: sceneBeast,
  wonder: sceneWonder,
  fracture: sceneFracture,
  rise: sceneRise,
  debt: sceneDebt,
};

/** 过渡句：两个转折点之间的空白，压缩成一句，但不要写成「无事发生」 */
const BRIDGE = [
  (n: string) => `这中间过了 ${n} 年。雨照下，粮照收，没有值得单独立传的事，只有人一天天老去。`,
  (n: string) => `${n} 年里，边境的界碑在雨里往北挪了三次，泥里插着旧木桩，没人为此写过一首诗。`,
  (n: string) => `${n} 年。新生儿在灶火边学会了父辈的仇恨，却不知道那仇恨从哪来。`,
  (n: string) => `然后是 ${n} 年的沉默。史书上只有一行：岁稔，无大战 —— 粮仓里的霉味，比血味更常见。`,
  (n: string) => `此后 ${n} 年，铁匠打的都是锄头。炉火照旧通红，只是没人再问刀口够不够。`,
];

/** 结尾：不升华，留一个未完成的动作 */
const ENDING = [
  '史官搁笔时，窗外正有人磨刀。',
  '这一卷写到这里，最后一页还空着。',
  '合上书的人没有立刻站起来。',
  '墨迹在末尾洇开了一小片，像一块洗不掉的污。',
  '灯芯烧到最后，没人去剪。',
  '他伸手去够下一卷的绳结，够了一下，又放下。',
  '有人在门外等他做决定。他没有开门。',
  '纸不够了。剩下的部分，他打算讲给儿子听。',
  '窗外起风，压纸的石头被吹偏了半寸。',
  '案上那杯茶早凉了，杯子底下压着一张没写完的名字。',
  '他把笔洗净，晾在架上，然后坐着听了一会儿雨。',
  '写到这一句时，他忽然想起一个早已死掉的人的脸。',
];

function chapterTitle(list: Turn[], era: number): string {
  const top = list.find((t) => t.kind !== 'debt') ?? list[0];
  const base = cnNum(era + 1);
  if (!top) return `第${base}卷 · 无事之卷`;
  const map: Record<TurnKind, string> = {
    rise: '一统',
    fall: '亡国',
    slay: '屠城',
    betray: '背盟',
    beast: '兽祸',
    fracture: '裂土',
    wonder: '造物',
    debt: '旧账',
  };
  return `第${base}卷 · ${map[top.kind]}`;
}

/**
 * 生成整部史书。
 * 每卷先立「因」（旧账/背盟），再写「果」（屠城/亡国/一统）；
 * 决定性的两三个事件详写，其余压缩成过渡句。
 */
export function buildChronicle(world: World): Chapter[] {
  const turns = findTurns(world);
  const byEra = new Map<number, Turn[]>();
  for (const t of turns) {
    const era = t.ev.era ?? 0;
    if (!byEra.has(era)) byEra.set(era, []);
    byEra.get(era)!.push(t);
  }

  const chapters: Chapter[] = [];
  const eras = [...byEra.keys()].sort((a, b) => a - b);
  for (const era of eras) {
    const all = byEra.get(era)!;
    // 先挑「因」，再挑「果」：一笔旧账 + 最多两个决定性事件
    const debts = all.filter((t) => t.kind === 'debt').slice(0, 1);
    const others = all
      .filter((t) => t.kind !== 'debt')
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2);
    const list = [...debts, ...others];
    if (!list.length) continue;
    list.sort((a, b) => a.year - b.year);

    const lines: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      lines.push(...SCENE_FN[t.kind](t, world, t.year + era * 7 + i * 13));
      // 台词是「人有血肉」的唯一凭证。名字会被忘，一句话不会。
      if (t.ev.quote) {
        const q = fact(t.ev.quote);
        if (q.length > 3) lines.push(`${q} —— 这句话后来被抄在很多张纸上，抄错的地方各不相同。`);
      }
      if (i < list.length - 1) {
        const gap = Math.round(list[i + 1].year - t.year);
        if (gap >= 8) lines.push(BRIDGE[(era * 3 + i + t.year) % BRIDGE.length](cnNum(gap)));
      }
    }
    lines.push(ENDING[(era * 5 + list.length * 3 + Math.round(list[0].year)) % ENDING.length]);

    chapters.push({ index: chapters.length, title: chapterTitle(list, era), lines });
  }
  return chapters;
}
