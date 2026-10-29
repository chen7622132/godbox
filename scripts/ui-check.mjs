import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto('http://localhost:4173/', { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shot1-genesis.png' });
console.log('✓ 创世界面已渲染');

// 全选四族，然后开始
await page.click('[data-race="1"]');
await page.click('[data-race="2"]');
await page.click('#btn-genesis');
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shot2-world.png' });
console.log('✓ 世界已生成');

// 加速到 4x，跑一会
await page.keyboard.press('3');
await page.waitForTimeout(7000);
await page.screenshot({ path: '/tmp/shot3-running.png' });

const state = await page.evaluate(() => {
  const year = document.getElementById('hud-year')?.textContent;
  const pop = document.getElementById('hud-pop')?.textContent;
  const nations = document.getElementById('hud-nations')?.textContent;
  const events = document.querySelectorAll('#chronicle-list li').length;
  return { year, pop, nations, events };
});
console.log('✓ 运行 7 秒后状态:', JSON.stringify(state));

// 点一下地图中心（查看工具）
const box = await page.locator('#world').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/shot4-inspect.png' });

// 放大
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/shot5-zoom.png' });

// 用陨石砸一下
await page.click('[title="砸出一个坑"]');
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shot6-meteor.png' });

// 存档 + 结算
await page.click('#btn-save');
await page.waitForTimeout(200);
await page.click('#btn-end');
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/shot7-ending.png', fullPage: true });

const hasEnding = await page.locator('#overlay .sheet h1').count();
console.log('✓ 结算界面:', hasEnding ? '已弹出' : '未弹出');

console.log('\n=== 错误 ===');
console.log(errors.length ? errors.join('\n') : '无');

await browser.close();
