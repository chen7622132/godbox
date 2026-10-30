import './styles.css';

import { generateWorld } from './core/world';
import { SIM_HZ, SPEEDS, type ToolId, type World, type WorldSizeKey } from './core/types';
import { stepWorld } from './sim/simulation';
import { seedRaces } from './sim/seed';
import { updateFire, updatePlague } from './sim/disasters';
import { applyTool, setToastSink } from './sim/tools';
import { Renderer } from './render/renderer';
import { buildToolbar } from './ui/toolbar';
import { buildHud } from './ui/hud';
import { Chronicle } from './ui/chronicle';
import { buildChronicle } from './core/epic';
import { Inspector } from './ui/inspector';
import { showGenesis, showEnding } from './ui/overlay';
import {
  saveToLocal, loadFromLocal, hasLocalSave, downloadSave, readSaveFile,
} from './ui/save';

// ============ 基础引用 ============
const canvas = document.getElementById('world') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const chronEl = document.getElementById('chronicle-list') as HTMLElement;
const inspectorEl = document.getElementById('inspector') as HTMLElement;

let world: World;
let renderer: Renderer;
const chronicle = new Chronicle(chronEl);
const inspector = new Inspector(inspectorEl);
const hud = buildHud();

let speedIdx = 1;
let paused = false;
let endingShown = false;
let brushRadius = 2;

// ============ 提示 ============
let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
}
setToastSink(toast);

// ============ 创世/播种 ============
// 播种逻辑见 sim/seed.ts（测试脚本共用同一份，避免两处参数不同步）

// ============ 启动 ============
async function boot(): Promise<void> {
  const choice = await showGenesis(overlay, hasLocalSave());

  if (choice === 'load') {
    const loaded = loadFromLocal();
    if (!loaded) {
      toast('没有找到存档');
      return boot();
    }
    startWorld(loaded);
    return;
  }

  const w = generateWorld({
    size: choice.size as WorldSizeKey,
    seed: choice.seed,
    landRatio: choice.landRatio,
    fragmentation: choice.fragmentation,
  });
  seedRaces(w, choice.races);
  startWorld(w);
  toast('世界已创生 · 左键施为，空格暂停');
}

function startWorld(w: World): void {
  world = w;
  endingShown = false;
  paused = false;
  speedIdx = 1;

  if (!renderer) {
    renderer = new Renderer(canvas, world);
    buildToolbar(document.getElementById('toolbar') as HTMLElement, (id: ToolId) => {
      currentTool = id;
      if (id === 'inspect') {
        // 切到查看模式时保留选中
      } else {
        inspector.hide();
        renderer.selected = null;
      }
      renderer.markDirty();
    });
  } else {
    renderer.attachWorld(world);
  }
  renderer.markDirty();
  chronicle.reset();
  chronicle.rebuildAll(world);
  inspector.hide();
  renderer.selected = null;
  lastFrame = performance.now();
}

let currentTool: ToolId = 'inspect';
let lastFrame = performance.now();
let acc = 0;
let uiFrame = 0;

// ============ 主循环 ============
function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (world && !paused && !world.ended) {
    acc += dt * SPEEDS[speedIdx] * SIM_HZ;
    let steps = Math.floor(acc);
    acc -= steps;
    steps = Math.min(steps, 80);
    for (let i = 0; i < steps; i++) {
      stepWorld(world);
      if (world.tick % 3 === 0) updateFire(world);
      if (world.tick % 12 === 0) updatePlague(world);
      if (world.ended) break;
    }
    // 地图层按 ~20fps 刷新就够（标注层仍是 60fps），否则逐格重上色会吃掉一半 CPU
    if (steps > 0 && world.tick % 3 === 0) renderer.markDirty();
  }

  if (world) {
    renderer.clampCam(world);
    renderer.render(world);
    // UI 文本每 6 帧刷一次就够（10fps），省得每帧重建 DOM
    uiFrame++;
    if (uiFrame % 6 === 0) {
      hud.update(world, speedIdx, paused);
      if (inspector.selected !== null) inspector.show(world, inspector.selected);
    }
    chronicle.sync(world);

    if (world.ended && !endingShown) {
      endingShown = true;
      paused = true;
      showEnding(overlay, world).then((res) => {
        if (res.restart) {
          world = null as unknown as World;
          renderer = null as unknown as Renderer;
          overlay.classList.add('show');
          boot();
        } else {
          renderer.markDirty();
        }
      });
    }
  }
  requestAnimationFrame(frame);
}

// ============ 输入 ============
let dragging = false;
let dragMoved = false;
let lastX = 0;
let lastY = 0;
let painting = false;
let paintCooldown = 0;

function pickSettlementAt(wx: number, wy: number): number | null {
  const z = renderer.cam.zoom;
  const tol = Math.max(1.2, 5 / z);
  let best: number | null = null;
  let bestD = Infinity;
  for (const s of world.settlements) {
    if (!s.alive || s.ruin) continue;
    const d = Math.hypot(s.x - wx, s.y - wy);
    if (d < tol && d < bestD) { bestD = d; best = s.id; }
  }
  return best;
}

function localXY(e: PointerEvent | MouseEvent | WheelEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!world) return;
  canvas.setPointerCapture(e.pointerId);
  const [sx, sy] = localXY(e);
  lastX = e.clientX;
  lastY = e.clientY;

  if (e.button === 2 || e.button === 1) {
    dragging = true;
    dragMoved = false;
    return;
  }
  if (e.button === 0) {
    painting = true;
    paintCooldown = 0;
    applyAt(sx, sy, e.shiftKey ? 2 : 1);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!world || !renderer) return;
  const [sx, sy] = localXY(e);
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  renderer.hover = { x: Math.floor(wx), y: Math.floor(wy) };
  renderer.hoverRadius = brushRadius;

  if (dragging) {
    renderer.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    dragMoved = true;
    return;
  }
  if (painting && paintCooldown <= 0) {
    applyAt(sx, sy, 1);
    paintCooldown = 2;
  }
  if (paintCooldown > 0) paintCooldown--;
});

function endPaint(): void {
  painting = false;
  dragging = false;
}
canvas.addEventListener('pointerup', endPaint);
canvas.addEventListener('pointercancel', endPaint);
canvas.addEventListener('pointerleave', () => {
  if (renderer) renderer.hover = null;
});

function applyAt(sx: number, sy: number, times: number): void {
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) return;

  if (currentTool === 'inspect') {
    const sid = pickSettlementAt(wx, wy);
    if (sid !== null) {
      renderer.selected = sid;
      inspector.show(world, sid);
    } else {
      renderer.selected = null;
      inspector.show(world, null, { x: gx, y: gy });
    }
    return;
  }

  for (let i = 0; i < times; i++) {
    applyTool(world, currentTool, gx, gy, brushRadius);
  }
  renderer.markDirty();
  const sid = pickSettlementAt(wx, wy);
  if (sid !== null && !inspectorEl.hidden) inspector.show(world, sid);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!renderer) return;
  const [sx, sy] = localXY(e);
  renderer.zoomAt(sx, sy, e.deltaY < 0 ? 1.25 : 0.8);
}, { passive: false });

// ============ 键盘 ============
window.addEventListener('keydown', (e) => {
  if (!world) return;
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      paused = !paused;
      break;
    case '1': speedIdx = 1; paused = false; break;
    case '2': speedIdx = 2; paused = false; break;
    case '3': speedIdx = 3; paused = false; break;
    case '4': speedIdx = 4; paused = false; break;
    case '[':
      brushRadius = Math.max(0, brushRadius - 1);
      renderer.hoverRadius = brushRadius;
      toast(`笔刷 ${brushRadius + 1}`);
      break;
    case ']':
      brushRadius = Math.min(12, brushRadius + 1);
      renderer.hoverRadius = brushRadius;
      toast(`笔刷 ${brushRadius + 1}`);
      break;
    case 'Escape':
      inspector.hide();
      renderer.selected = null;
      break;
    default:
      break;
  }
});

// ============ 顶部按钮 ============
hud.onSpeedClick(() => {
  if (paused) {
    paused = false;
    return;
  }
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  if (speedIdx === 0) { speedIdx = 1; paused = true; }
});

document.getElementById('btn-save')?.addEventListener('click', () => {
  if (!world) return;
  saveToLocal(world);
  toast('已存到浏览器');
});

document.getElementById('btn-load')?.addEventListener('click', () => {
  const w = loadFromLocal();
  if (!w) { toast('没有存档'); return; }
  startWorld(w);
  toast('存档已读取');
});

document.getElementById('btn-export')?.addEventListener('click', () => {
  if (!world) return;
  downloadSave(world);
  toast('存档文件已导出');
});

document.getElementById('btn-end')?.addEventListener('click', () => {
  if (!world) return;
  if (!world.ended) {
    world.ended = true;
    world.endReason = world.endReason || '神主动结束了这个世界';
  }
});

document.getElementById('btn-chron-toggle')?.addEventListener('click', () => {
  document.getElementById('chronicle')?.classList.toggle('collapsed');
});

// 编年史筛选：只看大事
let onlyMajor = false;
const chronFilterBtn = document.getElementById('btn-chron-filter');
chronFilterBtn?.addEventListener('click', () => {
  onlyMajor = !onlyMajor;
  chronFilterBtn.classList.toggle('active', onlyMajor);
  chronicle.setFilterImportant(onlyMajor);
  if (world) chronicle.rebuildAll(world);
  toast(onlyMajor ? '只看大事' : '显示全部事件');
});

// 史书视图：把流水账重写成纪传体章节（先立因，再写果）
const epicBtn = document.getElementById('btn-chron-epic');
const epicView = document.getElementById('epic-view');
const chronList = document.getElementById('chronicle-list');
let epicOn = false;
epicBtn?.addEventListener('click', () => {
  if (!world) return;
  epicOn = !epicOn;
  epicBtn.classList.toggle('active', epicOn);
  if (!epicView || !chronList) return;
  epicView.hidden = !epicOn;
  chronList.style.display = epicOn ? 'none' : '';
  if (!epicOn) return;

  const chapters = buildChronicle(world);
  epicView.innerHTML = '';
  if (!chapters.length) {
    const d = document.createElement('div');
    d.className = 'epic-empty';
    d.textContent = '这一年还没有值得立传的事。再等等 —— 账总要有人来收。';
    epicView.appendChild(d);
    return;
  }
  for (const c of chapters) {
    const box = document.createElement('div');
    box.className = 'epic-chapter';
    const h = document.createElement('div');
    h.className = 'epic-title';
    h.textContent = c.title;
    box.appendChild(h);
    for (let i = 0; i < c.lines.length; i++) {
      const p = document.createElement('p');
      p.className = 'epic-line' + (i === c.lines.length - 1 ? ' em' : '');
      p.textContent = c.lines[i];
      box.appendChild(p);
    }
    epicView.appendChild(box);
  }
});

// 拖拽导入存档
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  try {
    const w = await readSaveFile(f);
    startWorld(w);
    toast('已从文件读取存档');
  } catch (err) {
    toast('存档读取失败：' + (err as Error).message);
  }
});

// ============ 启动 ============
requestAnimationFrame(frame);
boot();
