import { CONFIG } from './config';
import type { MonitorState, PoolChange, PoolSnapshot, HistoryRecord, Position } from './types';

type Listener = () => void;

// 初始状态：content script 加载时立即计算，后续由 monitor.ts 从 IndexedDB 恢复持久化数据覆盖部分字段
const initialState: MonitorState = {
  isExpanded: CONFIG.defaultExpanded,
  isMonitoring: true, // 默认启用，Popup 开关可切换
  countdown: 0,
  totalCountdown: 0,
  status: '初始化中...',
  statusType: 'normal',
  poolSnapshots: {},
  changes: [],
  history: [],
  historyTotal: 0,
  memoryUsage: { usedMB: 0, limitMB: 0, percent: 0 },
  // 悬浮球默认位置：视口右下角，通过 defaultPosition 的负偏移计算得出
  collapsedPos: {
    x: window.innerWidth + CONFIG.defaultPosition.x,
    y: window.innerHeight + CONFIG.defaultPosition.y,
  },
  // 面板默认位置：视口右侧留 20px 边距，距顶部 60px
  expandedPos: {
    x: window.innerWidth - CONFIG.panelWidth - 20,
    y: 60,
  },
  isFlashing: false,
  chartCollapsed: true, // 趋势图表默认折叠，减少初始渲染开销
  changesCollapsed: false, // 需求变化默认展开，便于第一时间查看
  historyCollapsed: true,
  currentRound: 0,
  isTesting: false,
};

// 轻量级发布-订阅状态管理，驱动 React UI 通过 useMonitorState hook 响应状态变化
class MonitorStore {
  private state: MonitorState = { ...initialState };
  private listeners = new Set<Listener>();

  getState(): MonitorState {
    return this.state;
  }

  // 浅合并更新：创建新的 state 引用以触发 React 重渲染
  setState(partial: Partial<MonitorState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  // 订阅状态变化，返回取消订阅函数（与 React useEffect cleanup 配合使用）
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // 更新指定需求池的快照，使用不可变方式替换 poolSnapshots 对象
  updatePoolSnapshot(poolName: string, snapshot: PoolSnapshot) {
    this.setState({
      poolSnapshots: { ...this.state.poolSnapshots, [poolName]: snapshot },
    });
  }

  // 添加需求变化记录：所有变化累积保存（持久化到 IndexedDB），同时触发悬浮球闪烁 3 秒
  addChange(change: PoolChange) {
    const changes = [change, ...this.state.changes].slice(0, CONFIG.maxChangesRecords);
    this.setState({ changes, isFlashing: true });
    setTimeout(() => this.setState({ isFlashing: false }), 3000);
  }

  // 清除指定需求池的变化记录（UI 上的"清除"按钮触发）
  clearChange(poolName: string) {
    this.setState({
      changes: this.state.changes.filter((c) => c.poolName !== poolName),
    });
  }

  // 添加历史记录到内存列表头部，同时递增 historyTotal（注意：historyTotal 反映 DB 总量，不能用 history.length 覆盖）
  addHistoryRecord(record: HistoryRecord) {
    const history = [record, ...this.state.history].slice(0, CONFIG.maxHistoryRecords);
    this.setState({ history, historyTotal: this.state.historyTotal + 1 });
  }

  // 更新面板/悬浮球位置，展开和收起状态分别记忆独立坐标
  setPosition(type: 'collapsed' | 'expanded', pos: Position) {
    if (type === 'collapsed') {
      this.setState({ collapsedPos: pos });
    } else {
      this.setState({ expandedPos: pos });
    }
  }
}

export const store = new MonitorStore();
