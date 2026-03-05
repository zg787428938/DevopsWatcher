/**
 * 悬浮球组件：展示倒计时进度环和剩余秒数，根据阈值切换颜色（绿/黄/红），支持闪烁状态，可拖拽。
 */
import React from 'react';
import { CONFIG } from '../../config';
import type { MonitorState } from '../../types';

interface Props {
  state: MonitorState;
}

export const FloatingBall: React.FC<Props> = ({ state }) => {
  // 从 state 解构倒计时、总时长、是否闪烁
  const { countdown, totalCountdown, isFlashing } = state;
  // 计算进度比例：0~1，totalCountdown 为 0 时视为已完成（progress=1）
  const progress = totalCountdown > 0 ? countdown / totalCountdown : 1;

  // 根据配置计算圆环几何：半径、周长、用于 strokeDashoffset 的偏移量（逆时针减少表示进度减少）
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
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="3"
        />
        {/* 进度环：通过 strokeDasharray/strokeDashoffset 实现环形进度，旋转 -90 度使 12 点方向为起点 */}
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
      {/* 中心显示剩余秒数，颜色与环一致 */}
      <span className="countdown-text" style={{ color: ringColor }}>
        {countdown}
      </span>
    </div>
  );
};
