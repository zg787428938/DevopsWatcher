// 统一日志服务：正式监控和测试模式共享同一个日志存储
// 支持随时通过 Popup "下载日志"按钮导出已收集的日志
// 日志条目上限 MAX_ENTRIES，超出时丢弃最早的记录

import type { PoolChange, ApiResponseData } from '../../types';

export interface LogEntry {
  time: string;
  phase: string;
  status: 'PASS' | 'FAIL' | 'INFO' | 'WARN';
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 2000;

let logs: LogEntry[] = [];
let sessionStart = Date.now();
let mode: 'monitor' | 'test' = 'monitor';

export function resetLog(logMode: 'monitor' | 'test' = 'monitor') {
  logs = [];
  sessionStart = Date.now();
  mode = logMode;
}

export function log(phase: string, status: LogEntry['status'], message: string, detail?: string) {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  logs.push({ time, phase, status, message, detail });
  if (logs.length > MAX_ENTRIES) {
    logs = logs.slice(logs.length - MAX_ENTRIES);
  }
}

export function getLogCount(): number {
  return logs.length;
}

export function downloadLog() {
  if (logs.length === 0) {
    log('Download', 'INFO', '当前无日志');
  }
  triggerDownload();
}

export function formatApiData(data: ApiResponseData, url?: string, timestamp?: number): string {
  const parts = [
    `totalCount=${data.totalCount}`,
    `resultLength=${data.result.length}`,
    `pageSize=${data.pageSize}`,
    `toPage=${data.toPage}`,
  ];
  if (url) parts.push(`url=${url}`);
  if (timestamp) parts.push(`timestamp=${new Date(timestamp).toISOString()}`);
  if (data.result.length > 0) {
    parts.push(`firstItem="${data.result[0].subject}"`);
    if (data.result.length > 1) parts.push(`lastItem="${data.result[data.result.length - 1].subject}"`);
  }
  return parts.join(' ');
}

export function formatChange(change: PoolChange): string {
  const lines = [`oldCount=${change.oldCount} newCount=${change.newCount}`];
  if (change.added.length > 0) lines.push(`added(${change.added.length}): ${change.added.join(', ')}`);
  if (change.removed.length > 0) lines.push(`removed(${change.removed.length}): ${change.removed.join(', ')}`);
  return lines.join('\n');
}

function triggerDownload() {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const timeStr = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

  const title = mode === 'test' ? 'Test Report' : 'Monitor Log';
  const header = [
    '═'.repeat(60),
    `  DevOps Watcher - ${title}`,
    `  Mode: ${mode}`,
    `  Date: ${now.toLocaleString('zh-CN')}`,
    `  URL: ${location.href}`,
    `  Duration: ${((Date.now() - sessionStart) / 1000).toFixed(1)}s`,
    `  Entries: ${logs.length}` + (logs.length >= MAX_ENTRIES ? ` (capped at ${MAX_ENTRIES})` : ''),
    '═'.repeat(60),
    '',
  ].join('\n');

  let currentPhase = '';
  const body = logs.map((entry) => {
    let prefix = '';
    if (entry.phase !== currentPhase) {
      currentPhase = entry.phase;
      prefix = `\n── ${entry.phase} ${'─'.repeat(Math.max(0, 48 - entry.phase.length))}\n`;
    }
    const icon = { PASS: '✓', FAIL: '✗', INFO: '○', WARN: '⚠' }[entry.status];
    let line = `${prefix}[${entry.time}] ${icon} ${entry.status.padEnd(4)}  ${entry.message}`;
    if (entry.detail) {
      line += '\n' + entry.detail.split('\n').map((l) => '               ' + l).join('\n');
    }
    return line;
  }).join('\n');

  const pass = logs.filter((l) => l.status === 'PASS').length;
  const fail = logs.filter((l) => l.status === 'FAIL').length;
  const warn = logs.filter((l) => l.status === 'WARN').length;
  const summary = [
    '',
    '═'.repeat(60),
    `  PASS: ${pass}  FAIL: ${fail}  WARN: ${warn}  TOTAL: ${logs.length}`,
    '═'.repeat(60),
  ].join('\n');

  const content = header + body + summary;
  const prefix = mode === 'test' ? 'devops-watcher-test' : 'devops-watcher-log';
  const filename = `${prefix}-${dateStr}-${timeStr}.log`;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
