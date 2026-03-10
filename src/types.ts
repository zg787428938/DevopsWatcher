// 需求池配置项（预留扩展，当前通过 CONFIG.targets 字符串数组直接配置）
export interface PoolConfig {
  name: string;
}

// 云效 API 返回的单条需求项
export interface RequirementItem {
  subject: string;
  identifier: string; // 工作项唯一标识（用于获取详情）
}

// 从云效 API 响应中提取的核心数据结构，由 inject.ts 拦截并通过 postMessage 传递给 content script
export interface ApiResponseData {
  totalCount: number; // 该需求池的需求总数
  result: RequirementItem[]; // 当前页的需求列表
  toPage: number; // 当前页码，默认为 1
  pageSize: number; // 每页条数，默认为 100
}

// API 响应缓存条目，由 ApiBridge 管理，包含数据本体、接收时间戳和请求 URL
export interface CachedApiResponse {
  data: ApiResponseData;
  timestamp: number; // 响应被拦截的时间（Date.now()），用于新鲜度判断
  url: string;
}

// 需求池快照：记录某个需求池在某次检测时的完整状态，持久化到 IndexedDB
export interface PoolSnapshot {
  poolName: string; // 需求池名称，作为 IndexedDB 主键
  totalCount: number; // API 返回的需求总数
  requirements: string[]; // 所有需求名称列表（合并全部分页后），用于精确比对
  items?: RequirementItem[]; // 含 identifier 的完整需求项列表，用于详情查询
}

// 需求变化记录：两次检测之间检测到的差异，持久化到 IndexedDB 并在 UI 展示
export interface PoolChange {
  id?: number; // IndexedDB 自增主键，新建时不传
  poolName: string;
  oldCount: number; // 上次检测的需求总数
  newCount: number; // 本次检测的需求总数
  added: string[]; // 本次新增的需求名称列表
  removed: string[]; // 本次移除的需求名称列表
  timestamp: number; // 检测到变化的时间戳
}

// 历史快照记录：每轮检测完成后写入 IndexedDB，记录各需求池的数量
export interface HistoryRecord {
  id?: number; // IndexedDB 自增主键，新建时不传
  timestamp: number; // 记录时间戳，用于排序和索引
  timeStr: string; // 格式化的时间字符串（HH:mm:ss），用于 UI 展示
  pools: Record<string, number>; // 各需求池名称 -> 需求数量的映射
}

// 日志条目：记录监控和测试过程中的关键事件，持久化到 IndexedDB
export interface LogEntry {
  id?: number;
  time: string;
  ts: number;
  phase: string;
  status: 'PASS' | 'FAIL' | 'INFO' | 'WARN';
  message: string;
  detail?: string;
}

// 云效工作项字段选项（字段定义中的可选值）
export interface WorkitemFieldOption {
  identifier: string;
  value: string;
  displayValue: string;
  position: number | null;
  level: number | null;
  disabled: boolean;
}

// 云效工作项字段定义（从 /field/{id} API 获取的字段元信息）
export interface WorkitemFieldDef {
  identifier: string;
  name: string;
  displayName: string;
  type: string;       // NativeField | CustomField | SystemCustomField | Application
  format: string;     // list | multiList | input
  className: string;  // string | user | option | text | float | int | dateTime | ...
  defaultValue: string | null;
  options: WorkitemFieldOption[] | null;
  isRequired: boolean | null;
  isReadOnly: boolean;
  position: number;
}

// 字段值列表中的单个值项
export interface WorkitemFieldValueItem {
  value: string;
  valueEn: string | null;
  displayValue: string;
  identifier: string;
  level: number | null;
}

// 云效工作项字段值（从 /field/value/{id} API 获取）
export interface WorkitemFieldValue {
  fieldIdentifier: string;
  fieldFormat: string;
  fieldClassName: string;
  value: string;
  valueList: WorkitemFieldValueItem[];
  workitemIdentifier: string;
}

// 组合后的工作项字段（定义 + 值合并）
export interface WorkitemField {
  identifier: string;
  name: string;
  displayName: string;
  type: string;
  format: string;
  className: string;
  value: string;
  displayValue: string;
  valueList: WorkitemFieldValueItem[];
  options: WorkitemFieldOption[] | null;
}

// 完整的工作项详情（字段定义 + 字段值合并后的结构）
export interface WorkitemDetail {
  workitemId: string;
  fields: WorkitemField[];
  fieldMap: Record<string, WorkitemField>;
  timestamp: number;
}

// 面板/悬浮球在视口中的绝对像素位置
export interface Position {
  x: number;
  y: number;
}

// 全局监控状态，由 MonitorStore 管理，驱动所有 React UI 渲染
export interface MonitorState {
  isExpanded: boolean; // 面板是否展开（true=展开面板 false=收起为悬浮球）
  isMonitoring: boolean; // 监控是否启用（由 Popup 开关控制）
  countdown: number; // 当前轮次剩余秒数
  totalCountdown: number; // 当前轮次总秒数（用于计算进度环百分比）
  status: string; // 状态栏文字，描述当前/下一步操作
  statusType: 'normal' | 'warning' | 'error'; // 状态文字颜色类型
  poolSnapshots: Record<string, PoolSnapshot>; // 各需求池最新快照，poolName -> PoolSnapshot
  changes: PoolChange[]; // 所有需求变化列表（持久化到 IndexedDB，按时间倒序累积）
  history: HistoryRecord[]; // 已加载到内存的历史记录（从 IndexedDB 按需分页加载）
  historyTotal: number; // IndexedDB 中历史记录总条数，用于 UI 展示和分页判断
  memoryUsage: { usedMB: number; limitMB: number; percent: number }; // JS 堆内存使用信息
  collapsedPos: Position; // 悬浮球（收起状态）的位置，持久化到 IndexedDB
  expandedPos: Position; // 面板（展开状态）的位置，持久化到 IndexedDB
  isFlashing: boolean; // 悬浮球是否正在闪烁蓝色光晕（有新通知时触发，3秒后自动关闭）
  chartCollapsed: boolean; // 趋势图表折叠区域是否收起
  changesCollapsed: boolean; // 需求变化折叠区域是否收起
  historyCollapsed: boolean; // 历史记录折叠区域是否收起
  requirementsCollapsed: boolean; // 需求列表折叠区域是否收起
  detailView: { identifier: string; subject: string } | null; // 当前正在查看的需求详情（null 为主页）
  currentRound: number; // 当前检测轮次编号，每轮递增
  isTesting: boolean; // 是否正在执行测试流程（与监控互斥）
}

// inject.ts 通过 window.postMessage 发送给 content script 的消息格式
export interface ApiInterceptMessage {
  type: 'DEVOPS_WATCHER_API_RESPONSE';
  data: ApiResponseData;
  url: string;
}

// content script 通过 chrome.runtime.sendMessage 发送给 background 的通知请求
export interface NotificationPayload {
  type: 'CREATE_NOTIFICATION';
  title: string;
  message: string;
  duration: number; // 通知自动消失时长（毫秒），0 表示不自动消失
}

// Popup 发送给 content script 的状态查询消息
export interface QueryStateMessage {
  type: 'QUERY_STATE';
}

// Popup 发送给 content script 的监控开关切换消息
export interface SetMonitoringMessage {
  type: 'SET_MONITORING';
  enabled: boolean;
}

// Popup 发送给 content script 的下载日志消息
export interface DownloadLogMessage {
  type: 'DOWNLOAD_LOG';
}

// Popup 发送给 content script 的重置位置消息
export interface ResetPositionMessage {
  type: 'RESET_POSITION';
}

// content script 响应 Popup QUERY_STATE 请求的数据
export interface StateResponse {
  isMonitoring: boolean;
  isTesting: boolean;
}

// inject.ts → content script 的字段定义消息
export interface FieldDefsInterceptMessage {
  type: 'DEVOPS_WATCHER_FIELD_DEFS';
  workitemId: string;
  data: WorkitemFieldDef[];
  url: string;
}

// inject.ts → content script 的字段值消息
export interface FieldValuesInterceptMessage {
  type: 'DEVOPS_WATCHER_FIELD_VALUES';
  workitemId: string;
  data: WorkitemFieldValue[];
  url: string;
}

// content script → background 的消息联合类型
export type MessageToBackground = NotificationPayload;
// Popup → content script 的消息联合类型
export type MessageToContent = QueryStateMessage | SetMonitoringMessage | DownloadLogMessage | ResetPositionMessage;
