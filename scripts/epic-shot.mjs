import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 提速：点 speed 按钮到最高档
for (let i = 0; i < 6; i++) {
  await page.click('#btn-speed').catch(() => {});
  await page.waitForTimeout(120);
}
// 跑一段时间，让世界长出历史
await page.waitForTimeout(22000);

// 打开史书
await page.click('#btn-chron-epic').catch(() => {});
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/epic-view.png' });

const txt = await page.evaluate(() => {
  const el = document.getElementById('epic-view');
  return el ? el.innerText.slice(0, 900) : 'NO EPIC VIEW';
});
console.log('--- 史书可见文本 ---\n' + txt);
console.log('--- 错误 ---', errs.length ? errs.slice(0, 5) : '无');
await browser.close();
