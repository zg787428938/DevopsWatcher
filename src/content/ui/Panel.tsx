import React, { useCallback } from 'react';
import { CONFIG } from '../../config';
import { store } from '../../store';
import { useSelector } from './hooks';
import { PoolCards } from './PoolCards';
import { StatusBar } from './StatusBar';
import { TrendChart } from './TrendChart';
import { ChangesSection } from './ChangesSection';
import { RequirementsSection } from './RequirementsSection';
import { HistorySection } from './HistorySection';
import { DetailPage } from './DetailPage';

interface Props {
  maxHeight?: number;
}

export const Panel: React.FC<Props> = ({ maxHeight }) => {
  const { countdown, poolSnapshots, status, statusType, memoryUsage,
    requirementsCollapsed, chartCollapsed, changesCollapsed, historyCollapsed,
    changes, history, historyTotal, detailView } = useSelector((s) => ({
    countdown: s.countdown,
    poolSnapshots: s.poolSnapshots,
    status: s.status,
    statusType: s.statusType,
    memoryUsage: s.memoryUsage,
    requirementsCollapsed: s.requirementsCollapsed,
    chartCollapsed: s.chartCollapsed,
    changesCollapsed: s.changesCollapsed,
    historyCollapsed: s.historyCollapsed,
    changes: s.changes,
    history: s.history,
    historyTotal: s.historyTotal,
    detailView: s.detailView,
  }));

  let countdownColor = '#334155';
  if (countdown <= CONFIG.dangerThreshold) {
    countdownColor = '#dc2626';
  } else if (countdown <= CONFIG.warningThreshold) {
    countdownColor = '#d97706';
  }

  const toggleRequirements = useCallback(() => {
    const s = store.getState();
    store.setState({
      requirementsCollapsed: !s.requirementsCollapsed,
      ...(!s.requirementsCollapsed ? {} : { chartCollapsed: true, changesCollapsed: true, historyCollapsed: true }),
    });
  }, []);

  const toggleChart = useCallback(() => {
    const s = store.getState();
    store.setState({
      chartCollapsed: !s.chartCollapsed,
      ...(!s.chartCollapsed ? {} : { requirementsCollapsed: true, changesCollapsed: true, historyCollapsed: true }),
    });
  }, []);

  const toggleChanges = useCallback(() => {
    const s = store.getState();
    store.setState({
      changesCollapsed: !s.changesCollapsed,
      ...(!s.changesCollapsed ? {} : { requirementsCollapsed: true, chartCollapsed: true, historyCollapsed: true }),
    });
  }, []);

  const toggleHistory = useCallback(() => {
    const s = store.getState();
    store.setState({
      historyCollapsed: !s.historyCollapsed,
      ...(!s.historyCollapsed ? {} : { requirementsCollapsed: true, chartCollapsed: true, changesCollapsed: true }),
    });
  }, []);

  if (detailView) {
    return (
      <div className="dw-panel" style={maxHeight ? { maxHeight } : undefined}>
        <DetailPage identifier={detailView.identifier} subject={detailView.subject} />
      </div>
    );
  }

  return (
    <div className="dw-panel" style={maxHeight ? { maxHeight } : undefined}>
      <div className="dw-titlebar" data-drag-handle>
        <div className="dw-titlebar-left">
          <span className="dw-titlebar-title">DevOps Watcher</span>
          <span className="dw-badge">{CONFIG.targets.length}</span>
        </div>
        <div className="dw-titlebar-right">
          <span className="dw-titlebar-countdown" style={{ color: countdownColor }}>
            {countdown}s
          </span>
          <button
            className="dw-close-btn"
            onClick={() => store.setState({ isExpanded: false })}
            title="收起"
            aria-label="收起面板"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="dw-content" data-no-drag>
        <PoolCards snapshots={poolSnapshots} />

        <StatusBar
          status={status}
          statusType={statusType}
          memoryUsage={memoryUsage}
        />

        <RequirementsSection
          snapshots={poolSnapshots}
          collapsed={requirementsCollapsed}
          onToggle={toggleRequirements}
        />

        <TrendChart
          history={history}
          collapsed={chartCollapsed}
          onToggle={toggleChart}
        />

        <ChangesSection
          changes={changes}
          collapsed={changesCollapsed}
          onToggle={toggleChanges}
        />

        <HistorySection
          history={history}
          historyTotal={historyTotal}
          collapsed={historyCollapsed}
          onToggle={toggleHistory}
        />
      </div>
    </div>
  );
};
