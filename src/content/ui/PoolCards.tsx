import React from 'react';
import { CONFIG, getTargetColor } from '../../config';
import type { PoolSnapshot } from '../../types';

interface Props {
  snapshots: Record<string, PoolSnapshot>;
}

export const PoolCards: React.FC<Props> = ({ snapshots }) => {
  const cols = Math.min(CONFIG.targets.length, 2);

  return (
    <div
      className="dw-pool-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {CONFIG.targets.map((name, idx) => {
        const snap = snapshots[name];
        const color = getTargetColor(idx);
        return (
          <div key={name} className="dw-pool-card">
            <span className="dw-pool-card-name" title={name}>
              {name}
            </span>
            <span className="dw-pool-card-count" style={{ color }}>
              {snap?.totalCount ?? '-'}
            </span>
          </div>
        );
      })}
    </div>
  );
};
