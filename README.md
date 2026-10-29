# GodBox · 上帝盒子

> 像素风创世沙盒。造一片大陆，撒下火种，看四族从蛮荒走到统一。
> 一局约 15 分钟。

![tech](https://img.shields.io/badge/TypeScript-Canvas2D-3178c6) ![license](https://img.shields.io/badge/license-MIT-green)

---

## 一、三种玩法，选一种

### 方式 A：双击就玩（零安装，最快）

1. 下载仓库里的 **`godbox.html`**
2. 双击用 Chrome / Edge 打开
3. 完事

> 所有代码（HTML + CSS + JS）都压在这一个文件里，66 KB，不需要联网、不需要装 Node。

### 方式 B：本地开发（改代码用这个）

```bash
npm install        # 第一次需要，装依赖
npm run dev        # 启动开发服务器，自动打开 http://localhost:5173
```

改任何 `.ts` 文件，浏览器里会自动刷新。

### 方式 C：传到 GitHub 上，用链接玩（推荐）

```bash
git init
git add .
git commit -m "godbox v1"
git branch -M main
git remote add origin https://github.com/你的用户名/godbox.git
git push -u origin main
```

然后进 GitHub 仓库页面：

1. **Settings → Pages**
2. **Source** 选 `GitHub Actions`
3. 等 1~2 分钟，地址就是 `https://你的用户名.github.io/godbox/`

仓库里已经配好 `.github/workflows/deploy.yml`，以后每次 `git push` 都会自动重新部署。
（这个地址同时还能直接访问 `https://你的用户名.github.io/godbox/godbox.html` 拿单文件版）

---

## 二、怎么玩

### 操作

| 操作 | 作用 |
|---|---|
| 左键点击 / 按住拖动 | 使用当前神迹工具 |
| 右键拖动 | 平移地图 |
| 滚轮 | 缩放 |
| 空格 | 暂停 / 继续 |
| `1` `2` `3` `4` | 1× / 2× / 4× / 8× 速度 |
| `[` `]` | 缩小 / 放大笔刷 |
| `Esc` | 取消选中 |

### 一局的标准流程

1. **创世**：选地图大小、陆地占比、破碎度，勾种族（默认人类 + 兽人，想看四族混战就全勾）
2. **看他们自己长**：营地 → 村庄 → 城镇 → 城市 → 都城，人口撑满后会派移民建新城
3. **建国**：同族聚落够多够大，会自动合并成国家，推出国王
4. **开战**：领土接壤 + 资源紧张 → 宣战 → 一场场战役 → 攻陷城市
5. **结局**：某国统一全部城市 / 全部文明灭绝 / 到第 9000 tick（15 分钟）自动结算

**想玩得爽的要点**：不要只围观。中期给弱国赐福（丰收、赐智），给强国降灾，制造拉锯战——比一边倒有意思得多。

### 工具说明

| 分组 | 工具 |
|---|---|
| 观测 | 查看（点城市看人口/科技/交战状态） |
| 生命 | 人类 / 精灵 / 矮人 / 兽人（各放一个营地） |
| 造陆 | 草原 / 森林 / 山地 / 沙地 / 水域 |
| 神迹 | 丰收（肥力↑）、治愈（灭火消瘟疫）、赐智（科技↑） |
| 灾难 | 天火、瘟疫、地震、陨石、洪水、抹除 |

---

## 三、模拟是怎么跑的（改代码前先看这个）

```
每 tick（1 tick = 2 世界年，每秒 10 tick）
├── 聚落成长     人口按 logistic + 常数项增长，受地形容量限制
├── 领土扩张     每 3 tick，按人口半径向外占格
├── 派移民       人口 > 容量 50% 时，在 26 格内找空地建新城（世界最多 32 城）
├── 国家日常     每 5 tick：科技累积、国王寿命、继承
├── 外交         每 4 tick：接壤 + 侵略性 → 宣战；霸权过半 → 触发同盟围攻
├── 战役         每 20 tick：战力 = 人口 × 0.105(攻)/0.125(守) × 种族 × 科技 × 将领天赋 × 城墙
├── 灾难蔓延     火每 3 tick，瘟疫每 12 tick
├── 时代事件     每 2200 tick：黑死病 / 山火 / 知识革命 / 大迁徙
└── 统计与终局   每 30 tick
```

**关键设计取舍**：不做逐个单位的寻路和战斗。军队用「战力数值 + 一场战役判定」代替，一个人口数字顶一千个士兵。这样 5 万格地图能跑 60fps，而叙事效果（谁打谁、谁死了）完全不受影响。

---

## 四、调参手册（你以后改数值看这里）

| 想改什么 | 文件 | 位置 |
|---|---|---|
| 一局多长 | `src/sim/simulation.ts` | `ROUND_TICKS = 9000` |
| 人口长多快 | `src/sim/simulation.ts` | `growSettlements()` 里 `0.042 + pop * 0.0028` |
| 城市容量 | `src/sim/simulation.ts` | `settlementCap()` 里 `40 + effF * 185` |
| 最多几座城 | `src/sim/simulation.ts` | `if (picked > 32)` |
| 建国门槛 | `src/sim/simulation.ts` | `if (leader.pop < 130)` |
| 多久打一仗 | `src/sim/simulation.ts` | `resolveCampaigns()` 里 `< 45` |
| 攻守强弱 | `src/sim/simulation.ts` | `nationPower()` 里 `0.105 / 0.125` |
| 同盟触发线 | `src/sim/simulation.ts` | 城市数过半 `* 0.5` |
| 种族平衡 | `src/core/races.ts` | 每个种族的 `growth / power / tech / aggression` |
| 地图生成 | `src/core/world.ts` | `generateWorld()` 里的地形阈值 |
| 配色 | `src/render/renderer.ts` | `PALETTE` 数组 |
| 时代事件 | `src/sim/simulation.ts` | `triggerEraEvent()` |

改完跑一次离线模拟看节奏对不对：

```bash
npm run simtest
```

它会用 4 个不同种子各跑 9000 tick，打印「建国 / 首战 / 首陷 / 结束 / 峰值人口 / 战争次数」——**这是判断改动是不是搞砸了的最快方式**。

---

## 五、项目结构

```
src/
├── core/            纯数据层，不碰 DOM（可以直接在 Node 里跑）
│   ├── types.ts     所有类型定义 + 常量
│   ├── rng.ts       可复现随机数（xorshift32）
│   ├── races.ts     四族数值与命名池
│   ├── world.ts     地形生成（分形噪声 + 岛屿遮罩）
│   └── events.ts    编年史
├── sim/             模拟层，不碰 DOM
│   ├── simulation.ts  主循环：人口/国家/科技/外交/战役/时代事件
│   ├── disasters.ts   火与瘟疫的蔓延、地震陨石洪水
│   ├── tools.ts       神迹工具的作用
│   └── seed.ts        创世播种
├── render/
│   └── renderer.ts  网格逐格上色 → 离屏 canvas → 缩放绘制
├── ui/               DOM 层
│   ├── hud.ts / toolbar.ts / chronicle.ts / inspector.ts
│   ├── overlay.ts    创世界面 + 结算界面
│   └── save.ts       存档（localStorage + 导出文件）
├── styles.css
└── main.ts           装配 + 输入 + 主循环
scripts/
├── simtest.ts        离线节奏测试
└── build-single.mjs  打成单文件 html
```

**分层原则**：`core` 和 `sim` 绝对不能 import DOM 或 render。这样模拟逻辑可以在命令行里跑测试，也能未来换成 Web Worker / 服务端。

---

## 六、存档

- 顶部「存档」→ 存到浏览器 localStorage（同一个浏览器下次能读）
- 顶部「导出」→ 下载 `.json` 文件，可以发给别人、可以 commit 进 git
- 把 `.json` 拖进浏览器窗口 → 直接读取

---

## 七、下一步（v2 候选）

- [ ] 四个种族全部上场时的平衡（当前默认只开两族）
- [ ] 英雄个体：能升级、能带兵单挑的具名角色
- [ ] 宗教系统：信仰传播、圣战
- [ ] 科技树可视化（点国家能看到它点出了什么）
- [ ] 编年史全文导出成 markdown（「我这一局的史书」）
- [ ] 编年史筛选（只看大事 / 只看某国）
- [ ] 地形渲染优化（当前每帧重画全部格子，大世界缩放时会掉帧）

---

## 许可

MIT。随便改随便发。
