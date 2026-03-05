// 通知服务：构建桌面通知内容并通过 background 发送，同时提供 Web Audio API 声音提醒
// 通知格式严格遵循 PRD 第 3.3 节的标题和正文规范

import { CONFIG } from '../../config';
import type { PoolChange } from '../../types';

// 根据需求变化构建通知标题和正文，通过 chrome.runtime.sendMessage 委托 background 创建桌面通知
export async function sendNotification(change: PoolChange): Promise<void> {
  const { poolName, oldCount, newCount, added, removed } = change;

  // 标题格式：📢 【需求池名称】 [+新增数 -移除数]，仅当有具体名称变化时显示 [+N -M]
  let title = `📢 【${poolName}】`;
  if (added.length > 0 || removed.length > 0) {
    title += ` [+${added.length} -${removed.length}]`;
  }

  const lines: string[] = [];

  // 数量变化行：使用 📈/📉 指示增减方向
  const diff = newCount - oldCount;
  if (diff > 0) {
    lines.push(`📈 ${oldCount}→${newCount} (+${diff})`);
  } else if (diff < 0) {
    lines.push(`📉 ${oldCount}→${newCount} (${diff})`);
  }

  // 新增需求列表：超过 30 字自动截断并加省略号
  if (added.length > 0) {
    lines.push('➕ 新增:');
    for (const name of added) {
      const display = name.length > 30 ? name.slice(0, 30) + '...' : name;
      lines.push(`  • ${display}`);
    }
  }

  // 移除需求列表
  if (removed.length > 0) {
    lines.push('➖ 移除:');
    for (const name of removed) {
      const display = name.length > 30 ? name.slice(0, 30) + '...' : name;
      lines.push(`  • ${display}`);
    }
  }

  const message = lines.join('\n');

  try {
    await chrome.runtime.sendMessage({
      type: 'CREATE_NOTIFICATION',
      title,
      message,
      duration: CONFIG.notificationDuration,
    });
  } catch (err) {
    console.error('[DevOps Watcher] Failed to send notification:', err);
    handleContextInvalidated(err);
  }
}

// 检测扩展上下文是否已失效（扩展被重新加载/更新），失效时刷新页面获取新的 content script
export function handleContextInvalidated(err: unknown): void {
  if (err instanceof Error && err.message.includes('Extension context invalidated')) {
    console.warn('[DevOps Watcher] Extension context invalidated, reloading page...');
    setTimeout(() => location.reload(), 1000);
  }
}

// AudioContext 单例，延迟创建以避免浏览器的自动播放策略限制
let audioCtx: AudioContext | null = null;

// 使用 Web Audio API 生成一个短促的双频正弦波蜂鸣声（880Hz → 660Hz，持续 0.3 秒）
export function playBeep(): void {
  if (!CONFIG.soundEnabled) return;

  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    // 双频效果：先 880Hz 后 660Hz，产生类似通知铃声的下降音调
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);

    // 音量渐出：从 0.3 指数衰减到 0.01，避免播放结束时的突兀截断噪音
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch (err) {
    console.error('[DevOps Watcher] Failed to play beep:', err);
  }
}
