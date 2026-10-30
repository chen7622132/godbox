/**
 * 单位精灵。
 *
 * 为什么要有这一层：原来每个小人每帧要画三四十个 fillRect，而且全是「色块拼色块」——
 * 没有描边、没有色阶，所以人一多就糊成一片噪声。这里做三件事：
 *
 *   1) 把整个小人画到离屏 canvas 上一次，之后每帧只 drawImage（快 20 倍）；
 *   2) 自动描一圈 1px 深色轮廓 —— 这是小尺寸像素画「能被认出来」的第一要素
 *      （1px outline + 2 阶明暗，是像素画公认的最小可读配方）；
 *   3) 同色系的暗部往蓝紫偏、亮部往暖黄偏，形体才不会死平。
 *
 * 远景（人只有 5~7 px）不建 sprite，直接画三块色 —— 那个尺寸上细节本来就不存在。
 */

export interface Look {
  skin: string;
  cloth: string;
  cloth2: string;
  hair: string;
  w: number;
  h: number;
}

export const RACE_LOOK: Look[] = [
  { skin: '#f2cfa8', cloth: '#3d6fa8', cloth2: '#2c5480', hair: '#5a3b22', w: 1.0, h: 1.0 },   // 人类
  { skin: '#e9e2cc', cloth: '#3f7f93', cloth2: '#2c5c6c', hair: '#dfe8b4', w: 0.82, h: 1.16 },  // 精灵（青蓝衣，与浅肤分开）
  { skin: '#e0b088', cloth: '#9c5236', cloth2: '#733a26', hair: '#8a5a2a', w: 1.22, h: 0.84 },  // 矮人（陶红衣，与棕发分开）
  { skin: '#7a9a52', cloth: '#5c4b33', cloth2: '#42341f', hair: '#241a10', w: 1.26, h: 1.0 },   // 兽人（皮革褐，避开绿皮与红布打架）
];

export interface UnitDrawOpts {
  race: number;
  job: string;
  state: string;
  dir: number;
  anim: number;
  role?: string;
  fx?: number;
  fy?: number;
  swing?: number;
  hp?: number;
}

const OUTLINE = '#181322';
const MAX_CACHE = 6000;

interface Sprite {
  c: HTMLCanvasElement;
  ax: number;
  ay: number;
}

const cache = new Map<string, Sprite>();

/** 走路 / 挥击的离散帧，只取 0 或 1，保证缓存的组合数不炸 */
function frameTag(u: UnitDrawOpts): string {
  const walk = u.state === 'walk' ? Math.floor(u.anim / 4) % 2 : 0;
  const stand = u.state === 'fight' ? Math.floor(u.anim / 3) % 2 : 0;
  return `${walk}${stand}`;
}

/** 给 sprite 描一圈 1px 深色轮廓：把小人和草地彻底分开 */
function addOutline(cv: HTMLCanvasElement): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width;
  const H = cv.height;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const or = 0x18;
  const og = 0x13;
  const ob = 0x22;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (src[i + 3] > 30) continue;
      let near = false;
      if (x > 0 && src[i - 4 + 3] > 60) near = true;
      else if (x < W - 1 && src[i + 4 + 3] > 60) near = true;
      else if (y > 0 && src[i - W * 4 + 3] > 60) near = true;
      else if (y < H - 1 && src[i + W * 4 + 3] > 60) near = true;
      if (near) {
        d[i] = or;
        d[i + 1] = og;
        d[i + 2] = ob;
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

function buildSprite(
  u: UnitDrawOpts,
  look: Look,
  H: number,
  W: number,
  flagCol: string,
): Sprite {
  // 留足边：帅旗最高会画到头顶上方 2 个身高处，旗面最宽再超出 2.6 个身宽
  const pad = 2;
  const cw = Math.ceil(W * 4 + pad * 2 + 8);
  const ch = Math.ceil(H * 3.3 + pad * 2);
  const cv =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : (null as unknown as HTMLCanvasElement);
  if (!cv) throw new Error('no canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d');
  if (!g) throw new Error('no ctx');
  g.imageSmoothingEnabled = false;

  const ax = Math.round(W * 2 + pad);
  const ay = Math.round(H * 2.1 + pad);
  drawBody(g as unknown as CanvasRenderingContext2D, ax, ay, H, W, u, look, 0, flagCol);
  addOutline(cv);

  return { c: cv, ax, ay };
}

/**
 * 画一个单位。所有细节都按身高分级 —— 小人矮的时候自动省略，放大才出现眼睛、腰带、靴子。
 * 这个函数被游戏渲染和图鉴脚本共用，避免「测试图好看、游戏里不一样」。
 */
export function paintUnit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  H: number,
  W: number,
  u: UnitDrawOpts,
  look: Look,
  now: number,
  flagCol = '#c8492f',
): void {
  // 远景：三块色，够看出「有人 / 哪边的人」
  if (H < 8) {
    const hw0 = Math.max(2, Math.round(W * 1.02));
    const hh0 = Math.max(1, Math.round(H * 0.34));
    const bx0 = Math.round(sx - W / 2);
    const byFoot0 = Math.round(sy + H / 2);
    ctx.fillStyle = 'rgba(10,14,10,0.3)';
    ctx.fillRect(bx0, byFoot0, W, 1);
    ctx.fillStyle = u.job === 'soldier' ? flagCol : u.job === 'priest' ? '#e8e4d4' : look.cloth;
    ctx.fillRect(bx0, byFoot0 - H + hh0, W, H - hh0);
    ctx.fillStyle = look.skin;
    ctx.fillRect(Math.round(sx - hw0 / 2), byFoot0 - H, hw0, hh0);
    if (u.state === 'fight') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(bx0 + W, byFoot0 - H + 1, 1, Math.max(1, Math.round(H * 0.5)));
    }
    return;
  }

  const key = `${u.race}|${u.job}|${u.role ?? ''}|${u.dir}|${H}|${W}|${frameTag(u)}|${flagCol}|${look.cloth}`;
  let sp = cache.get(key);
  if (!sp) {
    sp = buildSprite(u, look, H, W, flagCol);
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, sp);
  }
  ctx.drawImage(sp.c, Math.round(sx - sp.ax), Math.round(sy - sp.ay));

  // ---- 挥击残影：唯一不进 sprite 的东西（它比人大得多，而且只闪几帧）----
  if (u.state === 'fight' && (u.swing ?? 0) > 0) {
    const ang = u.dir === 0 ? Math.PI / 2 : u.dir === 1 ? Math.PI : u.dir === 2 ? 0 : -Math.PI / 2;
    const r1 = Math.max(6, W * 3.4);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, r1, ang - 0.9, ang + 0.9);
    ctx.closePath();
    ctx.fillStyle = 'rgba(226,244,255,0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, r1, ang - 0.9, ang + 0.9);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, Math.round(r1 * 0.08));
    ctx.stroke();
  }
}


function hexToRgb2(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 亮面：往暖黄偏（+R 多一些），像素画里光从来不是「白色稀释」 */
function lit(hex: string, k = 0.18): string {
  const [r, g, b] = hexToRgb2(hex);
  return toHex(r + 255 * k * 1.05, g + 255 * k * 0.95, b + 255 * k * 0.72);
}

/** 暗面：往蓝紫偏，而不是简单变黑 —— 这是色相偏移，也是「有厚度」的来源 */
function dim(hex: string, k = 0.24): string {
  const [r, g, b] = hexToRgb2(hex);
  return toHex(r * (1 - k) + 26 * k, g * (1 - k) + 20 * k, b * (1 - k) + 52 * k);
}

const METAL = '#b9c3cf';
const METAL_L = '#e6eef7';
const METAL_D = '#6d7787';
const WOOD = '#8a6136';
const WOOD_D = '#5d4021';
const BLADE = '#f2f7fd';
const LEATHER = '#6b4a2c';
const DARK = '#241a14';
const BONE = '#f7f2df';

/**
 * 画一个小人的「身体」。
 *
 * 坐标系基于 18 格身高（H=18 时正好 1:1 像素），所有部件都对齐这张网格 ——
 * 这是像素画和小画家的根本区别：不是「按比例堆色块」，而是「在网格上摆像素」。
 * 光源固定左上：每块都是 左/上亮一阶、右/下暗一阶，暗部往蓝紫偏。
 */
function drawBody(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  H: number,
  W: number,
  u: { race: number; job: string; state: string; dir: number; anim: number; role?: string; fx?: number; fy?: number; swing?: number },
  look: Look,
  now: number,
  flagCol = '#c8492f',
): void {
  const S = H / 18;
  const R = (v: number) => Math.round(v * S);
  const x0 = Math.round(sx - W / 2);
  const yb = Math.round(sy + H / 2); // 脚底基线

  // 一次 rect，坐标按 18 格基准换算
  const box = (col: string, gx: number, gy: number, gw: number, gh: number): void => {
    ctx.fillStyle = col;
    const px = x0 + R(gx);
    const py = yb - R(gy + gh);
    ctx.fillRect(px, py, Math.max(1, R(gw)), Math.max(1, R(gh)));
  };

  const race = u.race;
  const job = u.job;
  const role = u.role ?? (job === 'soldier' ? 'melee' : 'civilian');
  const kid = job === 'child';

  // ---- 色阶 ----
  const sk = look.skin;
  const skL = lit(sk, 0.24);
  const skD = dim(sk, 0.34);
  // 每个职业一个主色：远景（人只有 6~10 px）时，颜色就是唯一的职业信息
  const JOB_CLOTH: Record<string, string> = {
    farmer: '#bb8b46',
    wood: '#6b7a3a',
    mine: '#6a6f78',
    priest: '#e8e4d4',
  };
  const cl = JOB_CLOTH[job] ?? look.cloth;
  const clL = lit(cl, 0.2);
  const clD = dim(cl, 0.36);
  const hr = look.hair;
  const hrL = lit(hr, 0.22);
  const hrD = dim(hr, 0.3);

  // ---- 骨架尺寸（种族差异全在这里）----
  // 精灵瘦高、矮人矮宽、兽人驼背宽肩
  let headW = 6;
  let headH = 6;
  let bodyW = 6;
  let bodyTop = 12; // 躯干顶（从脚底往上算）
  let bodyBot = 6;
  let legH = 6;
  let shoulder = 0;
  if (race === 1) { headW = 4; headH = 6; bodyW = 4; bodyTop = 12; bodyBot = 7; legH = 7; }
  if (race === 2) { headW = 7; headH = 5; bodyW = 9; bodyTop = 10; bodyBot = 6; legH = 4; }
  if (race === 3) { headW = 8; headH = 5; bodyW = 9; bodyTop = 12; bodyBot = 6; legH = 6; shoulder = 2; }
  if (kid) { headW = 6; headH = 7; bodyW = 4; bodyTop = 10; bodyBot = 5; legH = 4; }

  const hx = -Math.floor(headW / 2);
  const bx0 = -Math.floor(bodyW / 2);
  const headTop = bodyTop + headH;
  const dirBack = u.dir === 3;

  // ================= 影子 =================
  ctx.fillStyle = 'rgba(10,12,10,0.34)';
  ctx.fillRect(x0 + R(bx0) + 1, yb - R(1), Math.max(2, R(bodyW)), Math.max(1, R(1)));

  // ================= 腿 =================
  const legW = race === 2 || race === 3 ? 3 : 2;
  const legGap = bodyW - legW * 2;
  const swingFrame = u.state === 'walk' ? Math.floor(u.anim / 4) % 2 : 0;
  const legL = legH - (swingFrame ? 1 : 0);
  const legR = legH - (swingFrame ? 0 : 1);
  // 左腿（受光侧）
  box(clD, bx0, 0, legW, Math.max(1, legL));
  box(dim(clD, 0.18), bx0, 0, 1, legL);
  // 右腿（背光侧）
  box(dim(clD, 0.22), bx0 + bodyW - legW, 0, legW, Math.max(1, legR));
  // 靴
  box(DARK, bx0, 0, legW, 1);
  box(DARK, bx0 + bodyW - legW, 0, legW, 1);
  if (legGap > 0) box('rgba(0,0,0,0)', bx0 + legW, 0, legGap, 1);

  // ================= 躯干 =================
  const torsoH = bodyTop - bodyBot;
  const armTop = bodyTop - 2;
  // 底层（布）
  box(cl, bx0, bodyBot, bodyW, torsoH);
  // 受光面：左侧一列亮
  box(clL, bx0, bodyBot, 1, torsoH);
  // 背光面：右侧一列暗
  box(clD, bx0 + bodyW - 1, bodyBot, 1, torsoH);
  // 肩线：最上面一行压一阶暗，让肩和胸分开
  box(dim(cl, 0.14), bx0, bodyTop - 1, bodyW, 1);
  // 领口 + 袖口：两条 1px 深线，是「衣服」和「色块」的分界
  box(clD, bx0 + 1, bodyTop - 1, Math.max(1, bodyW - 2), 1);
  box(dim(cl, 0.2), bx0, armTop - 2, 1, 1);
  box(dim(cl, 0.2), bx0 + bodyW - 1, armTop - 2, 1, 1);

  // ================= 腰带 =================
  if (!kid) {
    box(LEATHER, bx0, bodyBot + 2, bodyW, 1);
    box(flagCol, bx0 + Math.floor(bodyW / 2) - 1, bodyBot + 2, 2, 1); // 国色带扣
  }

  // ================= 手臂 =================
  const armLen = Math.max(2, torsoH - 3);
  const armSwing = swingFrame ? 1 : 0;
  // 左臂（受光）
  box(skL, bx0 - 1, armTop - 1 - armSwing, 1, armLen);
  // 右臂（背光）
  box(skD, bx0 + bodyW, armTop - 1 + armSwing, 1, armLen);

  // ================= 头 =================
  if (dirBack) {
    // 背面朝镜头：只有头发和一点脖子
    box(hr, hx, bodyTop, headW, headH);
    box(hrL, hx, bodyTop, headW, 1);
    box(hrD, hx + headW - 1, bodyTop, 1, headH);
    box(skD, hx + Math.floor(headW / 2) - 1, bodyTop - 1, 2, 1);
  } else {
    // 脖子
    box(skD, -1, bodyTop - 1, 2, 1);
    // 脸：左亮右暗
    box(sk, hx, bodyTop, headW, headH);
    box(skL, hx, bodyTop, 1, headH);
    box(skL, hx, bodyTop + headH - 1, headW, 1); // 额头顶光
    box(skD, hx + headW - 1, bodyTop, 1, headH);

    // 眼睛：2px，位置随种族微调
    const eyeY = bodyTop + Math.floor(headH * 0.52);
    ctx.fillStyle = DARK;
    if (headW >= 5) {
      ctx.fillRect(x0 + R(hx + 1), yb - R(eyeY + 1), Math.max(1, R(1)), Math.max(1, R(1)));
      ctx.fillRect(x0 + R(hx + headW - 2), yb - R(eyeY + 1), Math.max(1, R(1)), Math.max(1, R(1)));
    } else {
      ctx.fillRect(x0 + R(hx + Math.floor(headW / 2)), yb - R(eyeY + 1), 1, 1);
    }
  }

  // ================= 种族头部特征 =================
  if (race === 1 && !dirBack) {
    // 精灵：长发及肩 + 明显的尖耳（头高的 45%）
    box(hr, hx, bodyTop + headH - 2, headW, 2); // 刘海
    box(hrL, hx, bodyTop + headH - 1, headW, 1);
    box(hr, hx - 1, bodyTop - 1, 1, headH + 1); // 左侧长发垂到肩
    box(hrD, hx + headW, bodyTop - 1, 1, headH + 1);
    // 尖耳：这是一眼认出精灵的唯一可靠特征，必须够长、够尖、还往上翘
    const earH = Math.max(3, Math.round(headH * 0.75));
    box(skL, hx - 2, bodyTop + headH - 4, 2, earH);
    box(sk, hx + headW, bodyTop + headH - 4, 2, earH);
    // 发梢再往下垂一截，拉出修长的剪影
    box(hrD, hx - 1, bodyTop - 3, 1, 3);
    box(hrD, hx + headW, bodyTop - 3, 1, 3);
  } else if (race === 2 && !dirBack) {
    // 矮人：方头盔（平顶宽檐）+ 大胡子盖住半张脸和胸口
    box(METAL, hx - 1, bodyTop + headH - 2, headW + 2, 2);
    box(METAL_L, hx - 1, bodyTop + headH - 1, headW + 2, 1);
    box(METAL_D, hx - 1, bodyTop + headH - 2, headW + 2, 1);
    box(METAL_L, hx + Math.floor(headW / 2), bodyTop + 1, 1, 2);
    box(hrD, hx + headW - 1, bodyTop, 1, 2);
    // 胡子：亮金白（和棕皮肤差 40% 以上才分得开），从下巴一直盖到胸口
    const bw = headW + 2;
    const beard = '#efd39a';
    box(beard, hx - 1, bodyTop - 3, bw, 6);
    box('#fdf0c8', hx - 1, bodyTop + 2, bw, 1);           // 上唇高光
    box(dim(beard, 0.22), hx - 1, bodyTop - 3, bw, 1);     // 胡尖暗一阶
    box(dim(beard, 0.3), hx - 1, bodyTop - 4, bw - 2, 1);  // 须尾收窄
  } else if (race === 3 && !dirBack) {
    // 兽人：低额 + 獠牙 2×2 + 额纹
    box(hr, hx, bodyTop + headH - 2, headW, 2);
    box(hrD, hx, bodyTop + headH - 1, headW, 1);
    // 驼背：肩线比躯干宽出一圈，整个人显得「压着往前冲」
    box(dim(sk, 0.18), bx0 - 1, bodyTop - 1, bodyW + 2, 2);
    box(dim(sk, 0.34), bx0 - 1, bodyTop + 1, bodyW + 2, 1);
    // 眉骨：一道深色横线压着眼睛，凶相就出来了
    box(dim(sk, 0.5), hx + 1, bodyTop + Math.floor(headH * 0.6), Math.max(1, headW - 2), 1);
    // 獠牙：2×2 白块（1px 在这个尺寸会直接消失）+ 一条深嘴线衬托
    box(dim(sk, 0.6), hx + 1, bodyTop + 2, Math.max(1, headW - 2), 1);
    box(BONE, hx + 1, bodyTop, 2, 2);
    box(BONE, hx + headW - 3, bodyTop, 2, 2);
  } else if (!dirBack) {
    // 人类：短发
    box(hr, hx, bodyTop + headH - 2, headW, 2);
    box(hrL, hx, bodyTop + headH - 1, headW, 1);
    box(hrD, hx, bodyTop + headH - 2, 1, 1);
  }

  // ================= 职业与装备 =================
  const eqRight = bx0 + bodyW + 1;

  if (job === 'soldier') {
    if (role === 'general') {
      // ---- 将军：羽饰头盔 + 披风 + 长旗 ----
      const capeW = Math.max(2, Math.round(bodyW * 0.5));
      box(dim(flagCol, 0.1), bx0 - capeW, bodyBot + 1, capeW, torsoH - 1);
      box(lit(flagCol, 0.1), bx0 - capeW, bodyBot + 1, 1, torsoH - 1);
      // 头盔
      box(METAL, hx, bodyTop + headH - 3, headW, 3);
      box(METAL_L, hx, bodyTop + headH - 1, headW, 1);
      box(METAL_D, hx, bodyTop + headH - 3, headW, 1);
      box(METAL_D, hx + headW - 1, bodyTop + headH - 3, 1, 3);
      // 护鼻
      box(METAL_L, hx + Math.floor(headW / 2), bodyTop + 1, 1, 2);
      // 羽饰：国色一撮，必须够高
      box(flagCol, hx + Math.floor(headW / 2) - 1, bodyTop + headH, 2, 3);
      box(lit(flagCol, 0.25), hx + Math.floor(headW / 2) - 1, bodyTop + headH, 2, 1);
      // 帅旗：高过整个人
      box(WOOD_D, eqRight, bodyBot + 1, 1, 16);
      box(flagCol, eqRight + 1, 12, 6, 4);
      box(lit(flagCol, 0.3), eqRight + 1, 15, 6, 1);
      box(dim(flagCol, 0.3), eqRight + 1, 12, 6, 1);
      box(BONE, eqRight + 3, 13, 1, 2); // 旗心徽记
      // 佩剑
      box(METAL_L, bx0 - 2, bodyBot + 4, 1, 4);
      box(METAL_D, bx0 - 3, bodyBot + 4, 1, 1);
    } else if (role === 'archer') {
      // ---- 弓手：布帽 + 箭袋 + 竖弓 ----
      box(clD, hx - 1, bodyTop + headH - 2, headW + 2, 2);
      box(dim(clD, 0.2), hx - 1, bodyTop + headH - 1, headW + 2, 1);
      // 箭袋（背后一束，两根白羽）
      box(LEATHER, bx0 - 2, bodyBot + 2, 1, 5);
      box(BONE, bx0 - 2, bodyBot + 6, 1, 1);
      box(BONE, bx0 - 2, bodyBot + 4, 1, 1);
      // 弓：竖弧 + 弦，比矛更容易认
      const bowTop = bodyBot + Math.round(torsoH * 0.9);
      box(WOOD, eqRight, bodyBot, 1, torsoH - 1);
      box(WOOD, eqRight - 1, bowTop, 1, 1);
      box(WOOD, eqRight - 1, bodyBot, 1, 1);
      box('rgba(245,248,235,0.8)', eqRight + 1, bodyBot, 1, torsoH - 1);
      // 拉弓时手上有一支箭
      if (u.state === 'fight') box(BONE, eqRight + 1, bodyBot + Math.round(torsoH * 0.5), 2, 1);
    } else {
      // ---- 近战：头盔 + 长矛 + 圆盾 ----
      box(METAL, hx, bodyTop + headH - 3, headW, 3);
      box(METAL_L, hx, bodyTop + headH - 1, headW, 1);
      box(METAL_D, hx, bodyTop + headH - 3, headW, 1);
      box(METAL_D, hx + headW - 1, bodyTop + headH - 3, 1, 3);
      box(METAL_L, hx + Math.floor(headW / 2), bodyTop + 1, 1, 2); // 护鼻
      // 长矛：杆 + 矛头 + 尾铁
      box(WOOD, eqRight, bodyBot + 1, 1, 15);
      box(BLADE, eqRight - 1, 15, 3, 2);
      box(dim(METAL), eqRight, 14, 1, 1);
      box(METAL_D, eqRight, bodyBot + 1, 1, 1);
      // 圆盾：国色底 + 金属边 + 中心凸起
      const shX = bx0 - 3;
      const shY = bodyBot + 2;
      const shW = 3;
      const shH = Math.min(6, torsoH - 1);
      box(clD, shX, shY, shW, shH);
      box(flagCol, shX, shY + 1, shW, shH - 2);
      box(METAL_D, shX, shY, shW, 1);
      box(METAL_D, shX, shY + shH - 1, shW, 1);
      box(METAL_L, shX + 1, shY + Math.floor(shH / 2), 1, 1);
    }
  } else if (job === 'farmer') {
    // 农夫：宽檐草帽 + 大锄（锄刃横向 4px，24px 高时也一眼看得出）
    box('#c9a24a', hx - 2, bodyTop + headH - 1, headW + 4, 1);
    box('#e0c070', hx - 1, bodyTop + headH, headW + 2, 1);
    box('#a8832f', hx - 2, bodyTop + headH - 1, headW + 4, 1);
    box('#b08c38', hx - 2, bodyTop + headH, 1, 1);
    // 锄：斜杆 + 宽锄板
    box(WOOD, eqRight, bodyBot + 1, 2, 11);
    box(WOOD_D, eqRight, bodyBot + 1, 2, 2);
    box(METAL, eqRight - 2, bodyBot + 11, 4, 1);
    box(METAL_L, eqRight - 2, bodyBot + 12, 4, 1);
    box(METAL_D, eqRight - 2, bodyBot + 13, 2, 1);
  } else if (job === 'wood') {
    // 樵夫：双刃斧，斧头占 4×4
    box(clD, bx0, bodyTop - 1, bodyW, 1); // 肩巾
    box('#8c6a3a', bx0, bodyTop - 1, bodyW, 1);
    box(WOOD, eqRight, bodyBot + 1, 2, 11);
    box(METAL_L, eqRight - 1, bodyBot + 7, 5, 5);
    box('#e8eef6', eqRight - 1, bodyBot + 8, 5, 1);
    box('#c8cfd8', eqRight - 1, bodyBot + 9, 5, 2);
    box(METAL_D, eqRight + 3, bodyBot + 7, 1, 5);
    box(METAL_D, eqRight - 1, bodyBot + 11, 5, 1);
  } else if (job === 'mine') {
    // 矿工：安全帽 + 头灯 + 双头镐
    box('#7b6b4a', hx, bodyTop + headH - 2, headW, 2);
    box('#9b8a60', hx, bodyTop + headH - 1, headW, 1);
    box('#ffe27a', hx + Math.floor(headW / 2) - 1, bodyTop + headH - 3, 2, 1);
    box(WOOD, eqRight, bodyBot + 1, 2, 11);
    // 镐：横梁 5px + 两端下垂
    box(METAL, eqRight - 3, bodyBot + 10, 7, 1);
    box(METAL_L, eqRight - 3, bodyBot + 9, 7, 1);
    box(METAL_D, eqRight - 3, bodyBot + 10, 1, 2);
    box(METAL_D, eqRight + 3, bodyBot + 10, 1, 2);
  } else if (job === 'priest') {
    // 祭司：长袍（盖住腿）+ 金法杖 + 光环
    box('#e8e4d4', bx0, bodyBot - 1, bodyW, torsoH + 2);
    box('#f4f1e6', bx0, bodyBot - 1, 1, torsoH + 2);
    box('#cfc9b4', bx0 + bodyW - 1, bodyBot - 1, 1, torsoH + 2);
    box('#d4b23a', bx0 + Math.floor(bodyW / 2), bodyBot + 1, 1, torsoH);
    box('#ffe27a', eqRight, bodyBot, 1, 10);
    box('#ffd23a', eqRight - 1, bodyBot + 10, 3, 3);
    box('#fff8c8', eqRight, bodyBot + 11, 1, 1);
    box('#d4a020', eqRight - 1, bodyBot + 10, 3, 1);
    box('rgba(255,240,170,0.75)', hx, bodyTop + headH + 1, headW, 1);
  }

  // ---- 战斗中的兵器：挥砍时斜一下 ----
  if (u.state === 'fight' && role !== 'archer') {
    const t = Math.floor(u.anim / 3) % 2;
    if (t === 0) {
      box(BLADE, eqRight - 1, 15, 3, 3);
    } else {
      box(BLADE, eqRight + 1, bodyBot + 3, 3, 1);
    }
  }
}
