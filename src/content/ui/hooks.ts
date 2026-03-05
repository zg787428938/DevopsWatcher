/**
 * 内容脚本 UI 层使用的 React Hooks：提供对全局 store 中 MonitorState 的订阅式访问，使组件能响应状态变化并自动重渲染。
 */
import { useState, useEffect } from 'react';
import { store } from '../../store';
import type { MonitorState } from '../../types';

/** 订阅全局 store 的 MonitorState，状态变化时触发组件重渲染，返回当前完整监控状态 */
export function useMonitorState(): MonitorState {
  // 使用 useState 初始化并持有当前 store 状态，getState() 获取最新快照
  const [state, setState] = useState(store.getState());

  // 在挂载时订阅 store 变更，每次 store 更新时用 setState 触发重渲染；卸载时取消订阅
  useEffect(() => {
    return store.subscribe(() => setState(store.getState()));
  }, []);

  return state;
}
