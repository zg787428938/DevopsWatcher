// 全量配置参数，对应 PRD 第十一节，所有可调参数集中管理于此
export const CONFIG = {
  // 监控目标：需求池名称列表，必须与云效侧边栏菜单文字完全匹配
  targets: ["需求池", "iOS 需求池", "Android 需求池"],

  // [已弃用] 原设计为首轮跳过点击，PRD 已更新为首轮也执行点击收集数据，当前未使用此配置
  skipFirstRoundClick: true,
  // API 等待超时后的最大重试次数，超过后放弃本次检测（由 monitor.ts checkPool 使用）
  apiWaitMaxRetries: 3,
  // API 等待重试间隔（毫秒），每次重试之间的等待时间
  apiWaitRetryInterval: 5000,

  // API 响应缓存有效期（毫秒），同一响应在此窗口内不重复提取。注意：此值为参考配置，inject.ts 中有独立硬编码
  apiCacheTTL: 15_000,
  // 分页处理最大页数，0 表示不限制，超过此页数后停止翻页
  maxPages: 10,

  // 每轮随机检测间隔下限（秒），与 maxInterval 共同决定倒计时时长
  minInterval: 60,
  // 每轮随机检测间隔上限（秒）
  maxInterval: 120,
  // 倒计时归零后是否自动触发下一轮检测（由 countdown.ts 判断）
  autoTriggerOnCountdownEnd: true,
  // 倒计时剩余秒数 <= 此值时悬浮球进度环变为橙色
  warningThreshold: 30,
  // 倒计时剩余秒数 <= 此值时悬浮球进度环变为红色
  dangerThreshold: 10,

  // 需求变化触发通知时是否同步播放提示音（Web Audio API 正弦波蜂鸣）
  soundEnabled: true,
  // 桌面通知自动消失时长（毫秒），传给 background 用于 setTimeout clear
  notificationDuration: 10_000,

  // 插件启动时面板是否默认展开，false 表示默认收起为悬浮球
  defaultExpanded: false,
  // IndexedDB 中历史记录最大保留条数，超出时自动删除最旧记录
  maxHistoryRecords: 500,
  // IndexedDB 中需求变化记录最大保留条数，超出时自动删除最旧记录
  maxChangesRecords: 200,
  // 历史记录列表每次滚动加载的条数
  historyPageSize: 15,
  // 趋势图表最多显示的历史数据点数，取最近 N 条绘制折线
  chartMaxPoints: 100,
  // 悬浮球直径（像素），收起状态的圆形尺寸
  ballSize: 52,
  // 展开面板固定宽度（像素），也用于计算展开状态默认位置
  panelWidth: 360,

  // 点击菜单项后等待页面渲染的延迟（毫秒），模拟人眼阅读间隔
  clickRenderDelay: 150,
  // 翻页间隔范围（毫秒），每次点击"下一页"前随机等待此范围内的时间
  paginationDelayMin: 3000,
  paginationDelayMax: 8000,
  // [已弃用] 原设计为标签页重新可见后恢复倒计时的等待时间，PRD 已改为后台持续运行
  visibilityResumeDelay: 500,
  // 面板展开/收起状态切换后调整位置的延迟（毫秒）
  positionRestoreDelay: 50,
  // 展开图表折叠区域后触发 Chart.js 重绘的等待时间（毫秒）
  chartRedrawDelay: 100,

  // 侧边栏菜单坐标缓存有效期（毫秒），缓存期间复用已扫描到的 DOM 元素引用
  coordinateCacheTTL: 5 * 60_000,
  // 内容就绪判定阈值（毫秒）：若拦截到的 API 数据在此时间内则视为就绪，跳过 DOM 检查
  apiFreshnessThreshold: 2000,
  // API 数据超时后快速 DOM 轮询的最大次数
  fastPollMaxAttempts: 10,
  // 快速 DOM 轮询的间隔（毫秒）
  fastPollInterval: 50,

  // 是否启用加载超时熔断（recovery.ts），关闭后不会因超时自动刷新页面
  loadTimeoutEnabled: true,
  // 加载超时检测间隔（毫秒），recovery.ts 中 setInterval 的周期
  loadTimeoutCheckInterval: 10_000,
  // 加载超时触发阈值（毫秒），API 最后响应时间超过此值则判定为超时并刷新
  loadTimeoutThreshold: 60_000,
  // JS 堆内存刷新阈值（MB），超过此值触发通知并自动刷新页面
  memoryLimitMB: 1024,
  // 内存监控面板刷新频率（毫秒），控制 performance.memory 的轮询周期
  memoryCheckInterval: 2000,

  // 云效页面 DOM 选择器，与页面结构强绑定，云效改版时可能需要更新
  selectors: {
    // 侧边栏菜单项：用于查找需求池入口并模拟点击
    sidebarMenuItem: ".teamix-cloud-sidebar-side-filter-menu-item",
    // 当前激活的需求池标题：用于识别当前显示的是哪个需求池
    activeCategory: "[class*='workitemList--workitemCategory']",
    // 分页"下一页"按钮：用于模拟翻页操作收集所有分页数据
    nextPageBtn: ".next-btn.next-medium.next-btn-normal.next-pagination-item.next-next",
    // 分页"上一页"按钮：回退到第 1 页时使用（翻页残留状态修复）
    prevPageBtn: ".next-btn.next-medium.next-btn-normal.next-pagination-item.next-prev",
    // 加载中指示器：用于判断页面内容是否就绪（Fusion Design 的 loading 组件）
    loadingIndicator: ".next-loading",
  },

  // 拦截的 API 接口路径（参考值）。注意：inject.ts 运行在页面上下文中无法导入此模块，因此 inject.ts 中有独立硬编码的相同值
  apiPath: "/projex/api/workitem/workitem/list",
  // API 排除规则（参考值）：排除该路径的子路径如 /list/count
  apiExcludeSubPaths: ["/projex/api/workitem/workitem/list/"],

  // 各监控目标按索引循环使用的颜色，同时用于趋势图折线和需求池卡片数字
  chartColors: ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"],

  // 悬浮球默认初始位置偏移，相对于视口右下角的 (x, y) 偏移量
  defaultPosition: { x: -80, y: -100 },
} as const;

// 在 minInterval ~ maxInterval 范围内生成随机整数作为本轮检测间隔（秒）
export function getRandomInterval(): number {
  const range = CONFIG.maxInterval - CONFIG.minInterval;
  return CONFIG.minInterval + Math.floor(Math.random() * (range + 1));
}

// 根据监控目标索引获取对应颜色，超出颜色数组长度时循环复用
export function getTargetColor(index: number): string {
  return CONFIG.chartColors[index % CONFIG.chartColors.length];
}

// 将时间戳格式化为 MM/DD HH:mm:ss，用于 UI 中统一的时间展示
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}:${s}`;
}
