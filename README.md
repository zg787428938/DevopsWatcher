# DevOps Watcher — 开发指南

> 面向开发者和 AI 助手的技术文档。产品需求与功能规格请参见 [PRODUCT.md](./PRODUCT.md)。

## 快速命令

```bash
npm install                        # 安装依赖
node scripts/generate-icons.mjs    # 生成图标（首次或 public/icons 丢失时）
npm run build                      # 开发构建（不压缩）
NODE_ENV=production npm run build  # 生产构建（压缩）
npx tsc --noEmit                   # 类型检查
```

构建产物在 `dist/` 目录，Chrome 加载此目录即可。

---

## 架构总览

扩展由 4 个独立入口组成，运行在不同的 Chrome 上下文中，通过消息机制通信：

```
┌─────────────────────────────────────────────────────────────────┐
│  Page Context (inject.js)                                       │
│  劫持 fetch/XHR → 拦截云效 API 响应                              │
│           │ window.postMessage                                   │
├───────────┼─────────────────────────────────────────────────────┤
│  Content Script (content.js)          ← run_at: document_start  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Phase 1 (DOM 就绪前)                                     │    │
│  │  注入 inject.js → 启动 ApiBridge 监听                     │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Phase 2 (DOM body 就绪后)                                 │    │
│  │  创建 Shadow DOM → 挂载 React UI                          │    │
│  │  启动 Monitor 或 TestRunner（由 URL 参数决定）              │    │
│  └─────────────────────────────────────────────────────────┘    │
│           │ chrome.runtime.sendMessage                           │
├───────────┼─────────────────────────────────────────────────────┤
│  Background Service Worker (background.js)                      │
│  代理桌面通知 + 关闭测试标签页                                     │
├─────────────────────────────────────────────────────────────────┤
│  Popup (popup.html + popup.js)                                  │
│  监控开关 / 开始测试 / 下载日志 / 重置位置                        │
│           │ chrome.tabs.sendMessage → Content Script             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
src/
├── config.ts              # 全局配置参数（间隔、选择器、阈值等）+ 工具函数
├── types.ts               # 所有 TypeScript 接口定义（含 LogEntry）
├── store.ts               # 发布-订阅状态管理（驱动 React UI）
├── lib/
│   └── utils.ts           # cn() 工具函数（clsx + tailwind-merge）
├── vite-env.d.ts          # Vite 类型声明（*.css?inline）
├── inject/
│   └── index.ts           # 页面上下文 API 劫持（独立构建为 IIFE）
├── background/
│   └── index.ts           # Service Worker（通知代理 + 关闭标签页）
├── popup/
│   ├── index.html         # Popup HTML
│   └── index.ts           # Popup 逻辑（开关/测试/下载日志/重置位置）
└── content/
    ├── index.tsx           # Content Script 入口（两阶段初始化）
    ├── services/
    │   ├── api-bridge.ts   # API 数据桥接（缓存 + 异步等待 + 新鲜度隔离）
    │   ├── countdown.ts    # 倒计时调度（wall-clock + 均匀分布）
    │   ├── db.ts           # IndexedDB 封装（快照/历史/变化/位置/日志 五类数据，DB v3）
    │   ├── logger.ts       # 统一日志服务（IndexedDB 持久化，正式/测试模式共享，上限 2000 条）
    │   ├── memory.ts       # JS 堆内存监控
    │   └── notification.ts # 桌面通知 + Web Audio 蜂鸣音（上下文有效性预检）
    ├── engine/
    │   ├── monitor.ts      # 监控核心编排器（分页回退 + 数据完整性校验 + 去重）
    │   ├── scanner.ts      # 侧边栏菜单 DOM 扫描（带坐标缓存）
    │   ├── waiter.ts       # 三段式内容就绪等待
    │   ├── detector.ts     # 快照比对（新增/移除检测）
    │   ├── pagination.ts   # 模拟翻页收集全量数据
    │   ├── click.ts        # 模拟真实用户点击（Pointer+Mouse 事件序列）
    │   ├── recovery.ts     # 异常恢复（内存超限/API 超时延迟至轮次结束后刷新，上下文失效立即刷新）
    │   └── test-runner.ts  # 诊断测试套件（10 Phase + Summary）
    └── ui/
        ├── globals.css     # Tailwind CSS 指令 + shadcn CSS 变量（:host 作用域）
        ├── App.tsx         # 根组件（展开/收起切换 + 位置持久化）
        ├── FloatingBall.tsx # 悬浮球（倒计时进度环）
        ├── Panel.tsx       # 展开面板（互斥折叠区域容器）
        ├── PoolCards.tsx   # 需求池卡片（动态列数）
        ├── StatusBar.tsx   # 状态栏
        ├── TrendChart.tsx  # 趋势折线图（Chart.js）
        ├── ChangesSection.tsx # 需求变化列表（按池分组、持久化、带时间戳）
        ├── HistorySection.tsx # 历史记录（无限滚动 + 差值显示）
        ├── DragWrapper.tsx # 拖拽容器（中心锚点边界检测）
        ├── hooks.ts        # useMonitorState hook
        └── styles.ts       # Shadow DOM 内联 CSS（浅色主题，scrollbar-gutter: stable）
```

---

## 核心流程

### 监控生命周期

```
页面加载 (document_start)
  → 注入 inject.js 劫持 API
  → ApiBridge 开始监听
  → 等待 body 就绪
  → 挂载 Shadow DOM + React
  → db.init() + initLogger()：初始化 IndexedDB，加载持久化日志（过滤无 ts 的旧条目）
  → initialCollect()：
      读取当前页面的目标池数据（无点击）
      记录当前池索引，后续首轮调度跳过该池避免重复
  → CountdownService.startRound(estimatedPages, skipIndices)
      → 生成随机间隔 T（60~120 秒）
      → 生成操作序列：每个池的每一页各为一个操作
      → 操作[i] 在 T*(i+1)/(totalOps+1) 秒偏移触发（首尾留缓冲）
      → checkPool: simulateClick → waitForContentReady → waitForFreshResponse → finalizePool
      → finalizePool: 去重 → 数据完整性校验 → 快照比对 → 通知
      → 所有池检完 → onRoundComplete → 写入历史 + 变化
        → 检查 isRefreshPending()：若 recovery 已标记待刷新则 safeRefresh()
        → 否则开始下一轮
```

### 模拟点击（click.ts）

云效使用 React + Fusion Design / Teamix，简单的 `.click()` 不会触发 SPA 路由导航。必须发送完整事件序列：

1. `pointerover` → `pointerenter` → `mouseover` → `mouseenter`
2. `pointerdown` → `mousedown` → `focus`
3. `pointerup` → `mouseup` → `click`

所有事件带真实坐标（`clientX/Y`）和 `bubbles: true`。自动查找元素内部最深层可见子元素（`findDeepestVisibleChild`）以确保事件命中实际 DOM 节点。

### API 拦截（inject.ts）

- 运行在页面上下文（非 content script 隔离环境）
- 劫持 `window.fetch` 和 `XMLHttpRequest.prototype.open/send`
- 目标 API 路径通过构建时注入：`build.mjs` 从 `config.ts` 提取 `apiPath`，通过 Vite `define` 注入 `__INJECT_API_PATH__` 编译时常量
- 精确匹配路径，排除子路径（如 `/list/count`）
- 拦截到的数据通过 `window.postMessage` 发送给 content script

### 内容就绪等待（waiter.ts）

三段式策略：
1. API 新鲜度快判（`apiFreshnessThreshold: 2000ms`）→ 如果刚收到 API 数据则直接通过
2. DOM 快速轮询（`fastPollInterval: 50ms` × `fastPollMaxAttempts: 10`）→ 检查 loading 指示器消失 + API 新鲜度
3. MutationObserver 兜底（最长 10 秒）→ 监听 DOM 变化

**关键**：切换需求池前必须调用 `apiBridge.invalidateFreshness()` 使旧缓存失效，否则 waiter 会误将上一个池的数据视为就绪。

### 倒计时分布（countdown.ts）

将 N 个操作（含翻页）在 T 秒间隔内均匀分布，公式：

```
offset[i] = T * (i + 1) / (totalOps + 1)
```

- 首尾各留出 `T / (totalOps + 1)` 秒缓冲，避免操作紧贴轮次边界
- 使用 wall-clock（`Date.now()` 绝对时间戳）计算，不受后台标签页 `setInterval` 节流影响
- 倒计时显示使用 `Math.round` 而非 `Math.ceil`，消除 timer jitter 导致的秒数跳跃
- 互斥锁确保同一时间只有一个操作在执行

### 首轮初始池跳过

`initialCollect()` 检测当前页面是否已在某个目标池上。如果是，直接提取该池数据，并将该池索引记为 `initialPoolIndex`。`startRound(true)` 首轮调度时传入 `skipIndices` 跳过该池，避免立即点击离开当前页面。后续轮次不跳过。

### 翻页分布（pagination）

翻页操作与池切换操作统一纳入 `countdown.ts` 的操作序列。例如 2 个池、每个池 2 页时，操作序列为：

```
[池0-P1, 池0-P2, 池1-P1, 池1-P2]  → 4 个操作均匀分布在 T 秒内
```

每页的估计页数由上一轮检测结果 `estimatedPages` 提供，首轮默认每池 1 页。

---

## 数据持久化（db.ts）

IndexedDB 数据库 `devops-watcher`，当前版本 **v3**（v2 新增 `changes`，v3 新增 `logs`）。

| Object Store | 主键 | 索引 | 说明 |
|---|---|---|---|
| `snapshots` | `poolName` | — | 每个池最新的需求列表快照 |
| `history` | `id` (autoIncrement) | `timestamp` | 每轮检测的数量记录，上限 `maxHistoryRecords` |
| `changes` | `id` (autoIncrement) | `timestamp`, `poolName` | 需求变化详情（新增/移除），上限 `maxChangesRecords` |
| `positions` | `type` | — | UI 位置坐标（`collapsed` / `expanded`） |
| `logs` | `id` (autoIncrement) | — | 日志条目持久化，刷新后恢复，上限 `MAX_ENTRIES` |

`onupgradeneeded` 中按 store 是否存在逐一创建，支持从 v1 平滑升级到 v3。

---

## 状态管理（store.ts）

`MonitorStore` 基于发布-订阅模式，`setState` 触发所有订阅者回调，驱动 React 重渲染。

关键状态字段：

| 字段 | 说明 |
|---|---|
| `isMonitoring` | 是否正在监控 |
| `poolSnapshots` | 各池最新快照（`Map<poolName, PoolSnapshot>`） |
| `history` | 历史记录数组（内存中保留最近一页） |
| `changes` | 需求变化数组（全量累积，上限 `maxChangesRecords`） |
| `countdown` | 倒计时秒数 |
| `isExpanded` | 面板是否展开 |
| `chartCollapsed` / `changesCollapsed` / `historyCollapsed` | 折叠区域状态（互斥展开） |
| `collapsedPos` / `expandedPos` | 拖拽位置坐标 |

---

## 消息通信协议

| 方向 | 机制 | 消息类型 |
|---|---|---|
| inject → content | `window.postMessage` | `DEVOPS_WATCHER_API_RESPONSE` |
| content → background | `chrome.runtime.sendMessage` | `CREATE_NOTIFICATION` / `CLOSE_TAB` |
| popup → content | `chrome.tabs.sendMessage` | `QUERY_STATE` / `SET_MONITORING` / `DOWNLOAD_LOG` / `RESET_POSITION` |

---

## 日志系统（logger.ts）

正式监控和测试模式共享同一个 `Logger` 实例（单例）。每条日志包含 `time`、`ts`（毫秒时间戳）、`phase`、`status`（PASS/FAIL/INFO/WARN）、`message`、`detail`。

- **IndexedDB 持久化**：每条日志写入 `logs` store，页面刷新后通过 `initLogger()` 从 DB 恢复
- `initLogger()` 加载时过滤掉没有 `ts` 字段的旧条目（一次性迁移），并将 DB 同步清理
- 上限 `MAX_ENTRIES = 2000`，超出时丢弃最早记录（内存 + DB 同步裁剪）
- 正式模式下记录关键事件（池切换、变化检测、翻页、异常恢复、内存超限、上下文失效等）
- 测试模式下记录完整诊断信息
- `getLogs()` 接口供 TestRunner 在运行时读取日志生成结构化 Summary
- 通过 Popup「下载日志」按钮随时导出为 `.log` 文本文件
- **Duration 精确计算**：导出日志时从第一条有效日志的 `ts` 字段计算持续时间，不受页面刷新重置影响

---

## 测试模式（test-runner.ts）

通过 Popup 点击「开始测试」触发：关闭当前标签页，新开标签页（URL 追加 `_dwtest=1`）。content script 检测到此参数后运行 `TestRunner` 而非 `Monitor`。

分 10 个 Phase + Summary（全部使用真实数据和真实交互）：

| Phase | 名称 | 说明 |
|---|---|---|
| 1 | Environment | URL、UA、版本号、CONFIG、Shadow DOM、激活状态、inject.js 注入验证 |
| 2 | API | API 拦截验证 + 数据结构校验（totalCount/result/toPage/pageSize/subject） |
| 3 | Scanner | 侧边栏菜单扫描 |
| 4 | InitialCollect | 当前页面数据提取 + 多页感知（非首页时跳过快照保存避免误报） |
| 5 | CountdownRound | 完整倒计时轮询 + 分页残留检测 + 轮后快照完整性/去重校验 |
| 6 | UI | 悬浮球/面板/卡片点色/变化区块结构/数量差值/文字可选择性/scrollbar-gutter 稳定性 |
| 7 | Notification | 上下文有效性预检 + 桌面通知 + 蜂鸣音 + 权限状态 |
| 8 | IndexedDB | 快照去重/历史排序/时间间隔分析/连续重复检测/变化误报模式识别/位置合理性/日志持久化(`logs` store 记录数 + `ts` 字段完整性) |
| 9 | Memory | JS 堆内存 + 80% 阈值预警 |
| 10 | RuntimeHealth | 扩展上下文/API Bridge 一致性/Recovery 计算/DOM 选择器/分页状态/Store 状态/延迟刷新状态(`isRefreshPending`)/日志 `ts` 字段完整性 |
| — | Summary | 按 Phase 汇总 PASS/FAIL/WARN 计数，列出所有 FAIL 和 WARN 详情 |

测试完成后自动下载 `.log` 日志文件，然后通过 Background 关闭测试标签页。测试与正式监控互斥。

---

## 构建系统（build.mjs）

使用 Vite API 分 4 次独立构建：

| 入口 | 输出格式 | 文件 | 特殊处理 |
|---|---|---|---|
| `src/content/index.tsx` | IIFE | `dist/content.js` | `@vitejs/plugin-react` 处理 JSX |
| `src/inject/index.ts` | IIFE | `dist/inject.js` | `define` 注入 `__INJECT_API_PATH__` |
| `src/background/index.ts` | ES Module | `dist/background.js` | — |
| `src/popup/index.ts` | IIFE | `dist/popup.js` | — |

构建后自动复制 `manifest.json`、`popup.html`、`public/` 到 `dist/`。

**版本自动递增**：每次 `npm run build` 自动将 `manifest.json` 和 `package.json` 的 patch 版本号 +1（如 `1.0.8` → `1.0.9`），并将改动写回源文件。

**Tailwind CSS 处理**：Content Script 构建使用自定义 `cssInlinePlugin`，将 `?inline` 后缀的 CSS 文件通过 PostCSS + Tailwind 处理后内联为 JS 字符串，注入 Shadow DOM。

`NODE_ENV=production` 的差异：
- 启用 minify（esbuild 压缩）
- React 移除 dev warnings，体积更小
- 不影响业务逻辑

---

## 云效 DOM 选择器

在 `config.ts` 的 `selectors` 字段中集中管理，云效页面改版时需要更新：

| 选择器 | 用途 |
|---|---|
| `.teamix-cloud-sidebar-side-filter-menu-item` | 侧边栏菜单项 |
| `[class*='workitemList--workitemCategory']` | 当前激活的需求池标题 |
| `.next-btn.next-medium.next-btn-normal.next-pagination-item.next-next` | 分页"下一页"按钮 |
| `.next-btn.next-medium.next-btn-normal.next-pagination-item.next-prev` | 分页"上一页"按钮（分页回退用） |
| `.next-loading` | 加载中指示器 |

---

## 关键设计决策

### 为什么 content script 在 document_start 运行？
页面加载时云效会立即发起 API 请求。如果 inject.js 注入太晚会错过首个 API 响应。content script 分两阶段执行：Phase 1 注入 inject.js + 启动 ApiBridge；Phase 2 等 body 就绪后挂载 UI。

### 为什么用 Shadow DOM？
CSS 完全隔离，避免与云效页面样式互相干扰。所有 CSS 通过 JS 模板字符串（`styles.ts`）注入 Shadow DOM 内的 `<style>` 标签。

### 为什么 initialCollect 不点击其他池？
页面加载后短时间内密集点击多个菜单项会被识别为异常行为。`initialCollect` 仅提取当前页面已有的数据，其余池由 `CountdownService` 在各自的偏移时间自然触发。当前池还会被标记为 `skipIndices`，首轮不再重复检测。

### 为什么倒计时用 Math.round 而非 Math.ceil？
`setInterval(1000)` 的实际间隔有 ±几十毫秒的 jitter。`Math.ceil` 在整数边界附近会使连续两次 tick 的计算结果相差 2（例如 `ceil(93.01)=94` → `ceil(91.99)=92`，跳过 93）。`Math.round` 消除了此问题。

### 为什么折叠区域互斥展开（手风琴模式）？
趋势图表、需求变化、历史记录三个区域展开时各自可能占据大量高度。如果同时展开，面板总高度会远超视口，用户需要在外层滚动条和内层滚动条之间来回操作。互斥模式确保任一时刻只有一个区域展开，消除嵌套滚动问题。

### 为什么 finalizePool 要做数据完整性校验？
多页需求池翻页时可能因 DOM 状态残留、网络波动等原因导致某一页数据丢失。如果将不完整的数据保存为快照并与上次比对，会产生大量虚假的"需求被移除"变化。`finalizePool` 在保存快照前检查 `collected !== totalCount`，不匹配时跳过本轮变化检测并保留旧快照，避免级联误报。

### 为什么 handleFirstPage 要检查分页状态？
云效 SPA 切换需求池时不一定重置分页状态。如果上一个池停留在第 2 页，切换到新池后 API 可能返回 `toPage=2` 的数据。`handleFirstPage` 检测到 `toPage > 1` 时，通过模拟点击分页控件回到第 1 页，然后重新获取数据，确保从正确的起始位置收集。

### 为什么 safeRefresh 不用 location.reload()？
云效是 SPA 应用，某些情况下浏览器可能忽略 `reload()` 或从缓存恢复。通过 `window.location.href` 赋值附带时间戳参数（`_dw=timestamp`），强制生成一个新的 URL 导航请求。此方法同时处理了 hash 路由中 `?` 出现在 `#` 之后的特殊情况。

### 为什么测试完成后通过 Background 关闭标签页？
浏览器安全策略限制 `window.close()` 只能关闭由 `window.open()` 打开的窗口。测试标签页由 `chrome.tabs.create()` 创建，必须通过 `chrome.tabs.remove()` 关闭，而该 API 只在 Background Service Worker 中可用。因此 content script 发送 `CLOSE_TAB` 消息给 Background 完成关闭。

### 为什么面板使用 scrollbar-gutter: stable？
面板内容区（`.dw-content`）和折叠区域（`.dw-section-body`）使用 `overflow-y: auto`，滚动条仅在内容溢出时出现。传统 overlay scrollbar 出现/消失会导致内容区宽度变化，引起卡片网格、图表等元素重新布局产生视觉跳动。`scrollbar-gutter: stable` 始终为滚动条预留空间，无论是否溢出，消除了宽度跳变。

### 拖拽边界检测
以元素中心为锚点：中心点不超出视口即可，元素可部分露出边缘。公式：`x ∈ [-width/2, vw - width/2]`。展开和收起状态分别维护独立位置坐标，持久化到 IndexedDB。

---

## 已知限制

1. **多标签页冲突**：每个标签页独立运行 Monitor，同一变化可能触发重复通知。无跨标签页协调机制（可考虑 `BroadcastChannel` leader election）。
2. **URL 激活条件**：`shouldActivate()` 检查 `location.href.includes('?')`。云效使用 hash 路由，`?` 出现在 `#` 之后。如果云效改变 URL 结构去掉 `?`，扩展会静默失活。更健壮的方案是检查 `location.pathname` 前缀。
3. **多标签页监控状态独立**：`isMonitoring` 通过 `localStorage` 持久化（同源共享），刷新后自动恢复。但多标签页共享同一个 `localStorage` key，一个标签页的开关操作会影响其他标签页刷新后的初始状态。
4. **图标**：由 `scripts/generate-icons.mjs` 程序化生成（蓝色圆形 + 白色 D），也可替换为自定义 PNG（128×128，透明背景），放入 `public/icons/` 后重新构建。
5. **分页数据非原子性**：多页收集过程中如果需求池发生变化，各页数据可能不一致。通过完整性校验（`collected === totalCount`）兜底，不一致时跳过本轮。

---

## FAQ

### 架构

**Q: Background Service Worker 的必要性？**
`chrome.notifications` API 仅在 Background / Service Worker 上下文中可用，Content Script 无权调用。这是 Manifest V3 的标准模式。

**Q: 多入口构建会打包多份 React 吗？**
会。4 个入口运行在不同的 Chrome 上下文中，无法共享运行时模块，独立打包是 Chrome 扩展的标准实践。当前仅 content.js 包含 React（约 340KB）。

**Q: Popup → Content Script 消息时序问题？**
Content Script 未初始化完成时 `chrome.tabs.sendMessage` 会抛异常。Popup 中 `try/catch` 处理，显示 `"⚠ 无法连接"`。用户关闭重开 Popup 即可。

### 监控逻辑

**Q: 当前页面不在任何目标池时 initialCollect 如何处理？**
`scanner.getCurrentPoolName()` 返回 `null`，不提取数据，`initialPoolIndex` 为 `null`，`skipIndices` 为空。首轮所有池均由 CountdownService 按 `T*(i+1)/(totalOps+1)` 偏移调度。首次检测无旧快照时 `detectChanges` 返回 null，不触发通知。

**Q: 互斥锁超时 — 某个操作执行时间超过其分配的时间窗口？**
不会跳过后续操作，会延迟执行。`tick()` 每秒检查是否有待触发操作且互斥锁空闲。当前操作完成释放锁后，下一次 `tick()` 立即触发已到期的后续操作。轮次结束条件要求所有操作完成 + 锁空闲 + 倒计时归零，三者同时满足。

**Q: waiter.ts 三段等待全部超时后如何处理？**
`waitForContentReady()` 始终 resolve（不会 reject）。之后 `apiBridge.waitForFreshResponse(clickTime, 15s)` 等待 API 数据，超时进入重试循环（最多 `apiWaitMaxRetries=3` 次，每次重新点击菜单项并等待 `apiWaitRetryInterval=5s`）。全部失败后该池本轮跳过，不中断后续池和后续轮次。

**Q: recovery.ts 刷新后的状态恢复？**
`safeRefresh()` 通过 `window.location.href` 赋值带时间戳参数（`_dw=Date.now()`）强制导航（非 `location.reload()`，避免 SPA 忽略刷新）。刷新后 content script 重新执行两阶段初始化。`monitor.start()` 从 IndexedDB 恢复快照、历史、变化、位置和日志。`isMonitoring` 从 `localStorage` 恢复（用户手动关闭后刷新不会重新开启）。若 URL 含 `?` 且未被用户明确关闭，监控自动恢复。

**Q: recovery.ts 何时立即刷新，何时延迟？**
内存超限和 API 超时仅设置 `refreshScheduled = true` 标记，不立即刷新。`monitor.ts` 的 `onRoundComplete()` 在每轮结束时检查 `isRefreshPending()`，若为 true 则执行 `safeRefresh()`。这确保当前轮次的所有检测操作完整执行完毕后再刷新，避免中途中断丢失数据。唯一的例外是扩展上下文失效（`chrome.runtime.id` 不可用），此时扩展已无法正常工作，必须立即刷新。

### 测试与调试

**Q: TestRunner 如何验证"无变化"时的正确性？**
Phase 4 建立首次快照（无旧快照 → `detectChanges` 返回 null → PASS）；Phase 5 再次检测同一池（有旧快照 → 比对结果无论有无变化都记录详情）。日志完整列出需求列表和旧快照，供人工比对。

**Q: `_dwtest=1` 参数残留？**
测试完成后自动下载日志文件，然后通过 `CLOSE_TAB` 消息通知 Background 关闭标签页。如果关闭失败（如 Background 未响应），标签页保留，用户可手动关闭。

**Q: Chrome 后台标签页节流对监控的影响？**
Chrome 会将不可见标签页的 `setInterval` 节流至 1 分钟一次。由于使用 wall-clock 计算偏移，当标签页恢复可见时，所有已到期操作会在下一次 `tick()` 中依次触发。操作可能因此在短时间内密集执行，但不会丢失。
