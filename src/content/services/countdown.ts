// 倒计时服务：管理每轮检测的时间调度
// 将所有操作（包括各需求池的首页点击和翻页）均匀分散在倒计时周期内
// 使用 wall-clock（绝对时间戳）确保后台标签页定时器节流时仍然准确

import { CONFIG, getRandomInterval } from '../../config';
import { store } from '../../store';

type OperationCallback = (poolIndex: number, pageIndex: number) => Promise<void>;
type RoundCompleteCallback = () => void;

interface ScheduledOp {
  poolIndex: number;
  pageIndex: number;
  triggered: boolean;
}

export class CountdownService {
  private roundStartTime = 0;
  private totalInterval = 0;
  private operations: ScheduledOp[] = [];
  private isBusy = false;
  private roundComplete = false;
  private tickHandle: number | null = null;
  private onOperation: OperationCallback;
  private onRoundComplete: RoundCompleteCallback;

  constructor(onOperation: OperationCallback, onRoundComplete: RoundCompleteCallback) {
    this.onOperation = onOperation;
    this.onRoundComplete = onRoundComplete;
  }

  // estimatedPages[i] = 该池预估的页数；skipPoolIndices = 首轮已采集的池索引集合
  startRound(estimatedPages?: number[], skipPoolIndices?: Set<number>) {
    this.totalInterval = getRandomInterval();
    this.roundStartTime = Date.now();
    this.isBusy = false;
    this.roundComplete = false;

    const pages = estimatedPages ?? CONFIG.targets.map(() => 1);
    this.operations = [];
    for (let p = 0; p < CONFIG.targets.length; p++) {
      if (skipPoolIndices?.has(p)) continue;
      const pageCount = Math.max(1, pages[p]);
      for (let pg = 0; pg < pageCount; pg++) {
        this.operations.push({ poolIndex: p, pageIndex: pg, triggered: false });
      }
    }

    store.setState({
      countdown: this.totalInterval,
      totalCountdown: this.totalInterval,
      currentRound: store.getState().currentRound + 1,
    });

    if (this.tickHandle === null) {
      this.tickHandle = window.setInterval(() => this.tick(), 1000);
    }
  }

  stop() {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private tick() {
    if (!store.getState().isMonitoring) return;

    const now = Date.now();
    const elapsedSec = (now - this.roundStartTime) / 1000;
    const remaining = Math.max(0, Math.round(this.totalInterval - elapsedSec));

    store.setState({ countdown: remaining });

    // 按偏移量触发操作：operation[i] 在 T*(i+1)/(totalOps+1) 秒时触发，首尾留出等间距
    const totalOps = this.operations.length;
    if (!this.isBusy) {
      for (let i = 0; i < totalOps; i++) {
        const op = this.operations[i];
        if (op.triggered) continue;
        const offset = (this.totalInterval * (i + 1)) / (totalOps + 1);
        if (elapsedSec >= offset) {
          op.triggered = true;
          this.isBusy = true;
          this.onOperation(op.poolIndex, op.pageIndex)
            .catch(err => console.error('[DevOps Watcher] Operation failed:', err))
            .finally(() => { this.isBusy = false; });
          break;
        }
      }
    }

    // 轮次结束：倒计时归零 + 所有操作已触发 + 无进行中操作
    if (remaining <= 0 && this.operations.every(o => o.triggered) && !this.isBusy && !this.roundComplete) {
      this.roundComplete = true;
      if (CONFIG.autoTriggerOnCountdownEnd) {
        this.onRoundComplete();
      }
    }

    // 空闲时更新状态栏：显示下一个待触发的操作
    if (!this.isBusy && remaining > 0) {
      const nextIdx = this.operations.findIndex(o => !o.triggered);
      if (nextIdx !== -1) {
        const nextOp = this.operations[nextIdx];
        const nextOffset = Math.round((this.totalInterval * (nextIdx + 1)) / (totalOps + 1) - elapsedSec);
        const poolName = CONFIG.targets[nextOp.poolIndex];
        const pageInfo = nextOp.pageIndex > 0 ? ` P${nextOp.pageIndex + 1}` : '';
        store.setState({
          status: `等待中... ${nextOffset > 0 ? nextOffset + 's 后' : '即将'}检测 ${poolName}${pageInfo}`,
          statusType: 'normal',
        });
      } else if (store.getState().status !== '等待下一轮检测') {
        store.setState({ status: '等待下一轮检测', statusType: 'normal' });
      }
    }
  }
}
