// 此脚本通过 <script> 标签注入到页面上下文中运行（非 content script 隔离环境）
// 目的：劫持页面原生的 fetch/XHR 请求，拦截云效需求列表 API 响应数据
// 通过 window.postMessage 将提取的数据传递给 content script
// API_PATH 由 Vite define 在构建时从 config.ts 注入，消除与 config.ts 的双重硬编码

declare const __INJECT_API_PATH__: string;
const API_PATH = __INJECT_API_PATH__;
const MESSAGE_TYPE = 'DEVOPS_WATCHER_API_RESPONSE';

// 判断请求 URL 是否为目标 API：路径必须精确匹配 API_PATH，排除子路径（如 /list/count）
function shouldIntercept(url: string): boolean {
  try {
    const path = new URL(url, location.origin).pathname;
    if (!path.includes(API_PATH)) return false;
    const idx = path.indexOf(API_PATH);
    const remaining = path.substring(idx + API_PATH.length);
    // 路径在 API_PATH 之后只允许为空或单个斜杠，不允许有子路径
    return remaining === '' || remaining === '/';
  } catch {
    return false;
  }
}

// 从 API JSON 响应中提取核心数据，兼容多种嵌套结构（直接字段 / data 包装 / result 包装）
function extractApiData(json: any) {
  if (!json || typeof json !== 'object') return null;
  // 云效 API 约定：code === 200 表示业务成功
  if (json.code !== 200 && json.code !== '200') return null;

  // 依次尝试从 json 本身、json.data、json.result 中查找含有 totalCount + result[] 的对象
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
        result: data.result.map((item: any) => ({ subject: String(item.subject ?? '') })),
        toPage: data.toPage ?? 1,
        pageSize: data.pageSize ?? 100,
      };
    }
  }
  return null;
}

// 通过 postMessage 将提取的数据发送给 content script（content script 通过 window message 监听接收）
function postData(data: any, url: string) {
  window.postMessage({ type: MESSAGE_TYPE, data, url }, '*');
}

// ==================== Hook fetch ====================
const originalFetch = window.fetch;
window.fetch = async function (...args: any[]) {
  const response = await originalFetch.apply(this, args as any);
  try {
    // 从 fetch 参数中提取请求 URL，兼容 string / Request / URL 三种入参形式
    const reqUrl =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : String(args[0]);

    if (shouldIntercept(reqUrl)) {
      // clone() 避免消费原始 response body，页面代码仍可正常读取响应
      const clone = response.clone();
      clone
        .json()
        .then((json) => {
          const data = extractApiData(json);
          if (data) postData(data, reqUrl);
        })
        .catch(() => {}); // 非 JSON 响应静默忽略
    }
  } catch {} // 提取失败不应影响页面正常请求流程
  return response;
};

// ==================== Hook XMLHttpRequest ====================
const XHRProto = XMLHttpRequest.prototype;
const originalOpen = XHRProto.open;
const originalSend = XHRProto.send;

// open() 阶段记录请求 URL 到实例属性，供 send() 阶段判断是否拦截
XHRProto.open = function (method: string, url: string | URL, ...rest: any[]) {
  (this as any).__dwUrl = typeof url === 'string' ? url : url.toString();
  return originalOpen.apply(this, [method, url, ...rest] as any);
};

// send() 阶段：若 URL 匹配则注册 load 事件监听，在响应完成后提取数据
XHRProto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const url: string = (this as any).__dwUrl;
  if (url && shouldIntercept(url)) {
    this.addEventListener('load', function () {
      try {
        const json = JSON.parse(this.responseText);
        const data = extractApiData(json);
        if (data) postData(data, url);
      } catch {} // 解析失败静默忽略
    });
  }
  return originalSend.call(this, body);
};
