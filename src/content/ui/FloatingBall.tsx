import React from 'react';
import { CONFIG } from '../../config';
import { useSelector } from './hooks';

export const FloatingBall: React.FC = () => {
  const { countdown, totalCountdown, isFlashing } = useSelector((s) => ({
    countdown: s.countdown,
    totalCountdown: s.totalCountdown,
    isFlashing: s.isFlashing,
  }));

  const progress = totalCountdown > 0 ? countdown / totalCountdown : 1;

  const size = CONFIG.ballSize;
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);

  let ringColor = '#3b82f6';
  if (countdown <= CONFIG.dangerThreshold) {
    ringColor = '#dc2626';
  } else if (countdown <= CONFIG.warningThreshold) {
    ringColor = '#d97706';
  }

  return (
    <div
      className={`dw-ball${isFlashing ? ' flashing' : ''}`}
      data-drag-handle
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
      </svg>
      <span className="countdown-text" style={{ color: ringColor }}>
        {countdown}
      </span>
    </div>
  );
};
