import React from 'react';
import type { MonitorState } from '../../types';

interface Props {
  status: string;
  statusType: MonitorState['statusType'];
  memoryUsage: MonitorState['memoryUsage'];
}

export const StatusBar: React.FC<Props> = React.memo(({ status, statusType, memoryUsage }) => {
  const statusColor =
    statusType === 'error' ? '#dc2626' : statusType === 'warning' ? '#d97706' : '#059669';

  let memColor = '#059669';
  if (memoryUsage.percent > 80) {
    memColor = '#dc2626';
  } else if (memoryUsage.percent > 50) {
    memColor = '#d97706';
  }

  return (
    <div className="dw-status-bar">
      <span className="dw-status-text" style={{ color: statusColor }} title={status}>
        {status}
      </span>
      {/* 仅在存在内存限制时显示内存用量 */}
      {memoryUsage.limitMB > 0 && (
        <span className="dw-memory-text" style={{ color: memColor }}>
          {memoryUsage.usedMB}MB ({memoryUsage.percent}%)
        </span>
      )}
    </div>
  );
});
