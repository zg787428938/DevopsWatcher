// 此脚本通过 <script> 标签注入到页面上下文中运行（非 content script 隔离环境）
// 目的：劫持页面原生的 fetch/XHR 请求，拦截云效 API 响应数据
// 拦截三类 API：需求列表、工作项字段定义、工作项字段值
// 通过 window.postMessage 将提取的数据传递给 content script
// API 路径由 Vite define 在构建时从 config.ts 注入

declare const __INJECT_API_PATH__: string;
declare const __INJECT_FIELD_API_PATH__: string;
declare const __INJECT_FIELD_VALUE_API_PATH__: string;

const API_PATH = __INJECT_API_PATH__;
const FIELD_API_PATH = __INJECT_FIELD_API_PATH__;
const FIELD_VALUE_API_PATH = __INJECT_FIELD_VALUE_API_PATH__;

const MSG_LIST = 'DEVOPS_WATCHER_API_RESPONSE';
const MSG_FIELD_DEFS = 'DEVOPS_WATCHER_FIELD_DEFS';
const MSG_FIELD_VALUES = 'DEVOPS_WATCHER_FIELD_VALUES';

// 判断请求 URL 是否为需求列表 API：路径必须精确匹配 API_PATH，排除子路径（如 /list/count）
function isListApi(path: string): boolean {
  if (!path.includes(API_PATH)) return false;
  const idx = path.indexOf(API_PATH);
  const remaining = path.substring(idx + API_PATH.length);
  return remaining === '' || remaining === '/';
}

// 判断是否为字段相关 API，返回类型和 workitemId；field/value 路径更具体需先检查
function classifyFieldApi(path: string): { msgType: string; workitemId: string } | null {
  if (path.includes(FIELD_VALUE_API_PATH)) {
    const idx = path.indexOf(FIELD_VALUE_API_PATH);
    const remaining = path.substring(idx + FIELD_VALUE_API_PATH.length).replace(/\/$/, '');
    if (remaining && !remaining.includes('/')) {
      return { msgType: MSG_FIELD_VALUES, workitemId: remaining };
    }
  } else if (path.includes(FIELD_API_PATH)) {
    const idx = path.indexOf(FIELD_API_PATH);
    const remaining = path.substring(idx + FIELD_API_PATH.length).replace(/\/$/, '');
    if (remaining && !remaining.includes('/')) {
      return { msgType: MSG_FIELD_DEFS, workitemId: remaining };
    }
  }
  return null;
}

// 快速判断 URL 是否可能匹配任一拦截目标，避免对不相关请求解析 JSON
function shouldInterceptAny(url: string): boolean {
  try {
    const path = new URL(url, location.origin).pathname;
    return path.includes(API_PATH) || path.includes(FIELD_API_PATH);
  } catch {
    return false;
  }
}

// 从需求列表 API JSON 响应中提取核心数据，兼容多种嵌套结构
function extractListData(json: any) {
  if (!json || typeof json !== 'object') return null;
  if (json.code !== 200 && json.code !== '200') return null;

  const candidates = [json, json.data, json.result];
  for (const data of candidates) {
    if (
      data &&
      typeof data === 'object' &&
      typeof data.totalCount === 'number' &&
      Array.isArray(data.result)
    ) {
      return {
        totalCount: data.totalCount,
        result: data.result.map((item: any) => ({
          subject: String(item.subject ?? ''),
          identifier: String(item.identifier ?? ''),
        })),
        toPage: data.toPage ?? 1,
        pageSize: data.pageSize ?? 100,
      };
    }
  }
  return null;
}

// 统一处理拦截到的 API 响应，根据 URL 分发到不同的消息类型
function processResponse(reqUrl: string, json: any) {
  try {
    const path = new URL(reqUrl, location.origin).pathname;

    if (isListApi(path)) {
      const data = extractListData(json);
      if (data) {
        window.postMessage({ type: MSG_LIST, data, url: reqUrl }, '*');
      }
      return;
    }

    const fieldInfo = classifyFieldApi(path);
    if (fieldInfo && json?.code === 200 && Array.isArray(json.result)) {
      window.postMessage({
        type: fieldInfo.msgType,
        workitemId: fieldInfo.workitemId,
        data: json.result,
        url: reqUrl,
      }, '*');
    }
  } catch {}
}

// ==================== Hook fetch ====================
const originalFetch = window.fetch;
window.fetch = async function (...args: any[]) {
  const response = await originalFetch.apply(this, args as any);
  try {
    const reqUrl =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : String(args[0]);

    if (shouldInterceptAny(reqUrl)) {
      const clone = response.clone();
      clone.json().then((json) => processResponse(reqUrl, json)).catch(() => {});
    }
  } catch {}
  return response;
};

// ==================== Hook XMLHttpRequest ====================
const XHRProto = XMLHttpRequest.prototype;
const originalOpen = XHRProto.open;
const originalSend = XHRProto.send;

XHRProto.open = function (method: string, url: string | URL, ...rest: any[]) {
  (this as any).__dwUrl = typeof url === 'string' ? url : url.toString();
  return originalOpen.apply(this, [method, url, ...rest] as any);
};

XHRProto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const url: string = (this as any).__dwUrl;
  if (url && shouldInterceptAny(url)) {
    this.addEventListener('load', function () {
      try {
        const json = JSON.parse(this.responseText);
        processResponse(url, json);
      } catch {}
    });
  }
  return originalSend.call(this, body);
};

// ==================== 主动获取工作项详情 ====================
// content script 通过 postMessage 请求获取指定工作项的字段定义和字段值
// 使用 originalFetch 发起同源 GET 请求（浏览器自动携带 cookie），
// 响应通过 processResponse 走已有的拦截管道分发给 content script

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'DEVOPS_WATCHER_FETCH_DETAIL') {
    fetchWorkitemDetail(event.data.workitemId);
  }
});

async function fetchWorkitemDetail(workitemId: string) {
  try {
    const [defsResp, valuesResp] = await Promise.all([
      originalFetch(`${FIELD_API_PATH}${workitemId}?_input_charset=utf-8`),
      originalFetch(`${FIELD_VALUE_API_PATH}${workitemId}?_input_charset=utf-8`),
    ]);
    const [defsJson, valuesJson] = await Promise.all([
      defsResp.json(),
      valuesResp.json(),
    ]);
    processResponse(`${FIELD_API_PATH}${workitemId}`, defsJson);
    processResponse(`${FIELD_VALUE_API_PATH}${workitemId}`, valuesJson);
  } catch {}
}
