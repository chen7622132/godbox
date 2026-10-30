import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';

// 不能只靠代码判断「好看」，得把它画出来看。这里按右侧面板的真实宽度（340px）排版，
// 目的是验证：换行是否自然、行距是否够、章节标题是否压得住正文。
const FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
];
for (const f of FONT_CANDIDATES) if (fs.existsSync(f)) { GlobalFonts.registerFromPath(f, 'CJK'); break; }

const W = 340;
const PAD = 12;
const FS = 12.5;
const LH = 21;
const INNER = W - PAD * 2;

function wrap(ctx, text, indent = FS * 2) {
  const out = [];
  let line = '';
  let first = true;
  const limit = () => (first ? INNER - indent : INNER);
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > limit()) {
      out.push((first ? '　　' : '') + line);
      first = false;
      line = ch;
    } else line += ch;
  }
  if (line) out.push((first ? '　　' : '') + line);
  return out;
}

export function renderEpic(chapters, outPath) {
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = `${FS}px CJK`;
  const blocks = [];
  let h = 14;
  for (const c of chapters) {
    blocks.push({ type: 'title', text: c.title });
    h += 30;
    for (const l of c.lines) {
      const ls = wrap(probe, l);
      blocks.push({ type: 'line', lines: ls });
      h += ls.length * LH + 6;
    }
    h += 18;
  }
  h += 20;

  const canvas = createCanvas(W, h);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#12161c');
  g.addColorStop(1, '#0d1015');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h);

  let y = 22;
  for (const b of blocks) {
    ctx.font = `${FS}px CJK`;
    if (b.type === 'title') {
      ctx.fillStyle = '#e8d9b4';
      ctx.font = `bold ${FS + 1}px CJK`;
      ctx.fillText(b.text, PAD, y);
      ctx.fillStyle = '#2a3341';
      ctx.fillRect(PAD, y + 8, INNER, 1);
      y += 30;
    } else {
      for (const ln of b.lines) {
        ctx.fillStyle = '#c9c3b6';
        ctx.fillText(ln, PAD, y);
        y += LH;
      }
      y += 6;
    }
  }
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return { w: W, h };
}
