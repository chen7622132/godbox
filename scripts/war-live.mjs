/**
 * 线上回归：打开部署后的页面，创世、加速、跑 20 秒，抓 console 错误 + 截图。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.env.URL ?? 'https://chen7622132.github.io/godbox/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 创世界面：点「开辟新世界」（找得到的按钮逐个试）
for (const sel of ['#btn-new', '#btn-create', '.genesis button', 'button:has-text("开天辟地")', 'button:has-text("创世")', 'button:has-text("新世界")']) {
  const el = await page.$(sel);
  if (el) { await el.click().catch(() => {}); console.log('点击', sel); break; }
}
await page.waitForTimeout(1500);

// 加速到最高
for (let i = 0; i < 6; i++) {
  await page.click('#btn-speed').catch(() => {});
  await page.waitForTimeout(100);
}

// 跑 25 秒，期间多次采样 FPS
const fps = await page.evaluate(async () => {
  const out = [];
  let frames = 0;
  let last = performance.now();
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) { out.push(frames); frames = 0; last = now; }
    if (out.length < 20) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 21000));
  return out;
});

await page.screenshot({ path: '/tmp/live-war.png' });
console.log('FPS 采样：', fps.join(','));
console.log('平均 FPS：', (fps.reduce((a, b) => a + b, 0) / Math.max(1, fps.length)).toFixed(1));
console.log('错误：', errs.length ? errs.slice(0, 6) : '无');
await browser.close();
