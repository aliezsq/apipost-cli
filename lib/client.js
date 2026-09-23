'use strict';

/**
 * Apipost Open API V2 HTTP 客户端。
 * 鉴权：请求头 api-token（连字符），来源 APIPOST_TOKEN / --token。
 * host 完整透传（含协议），默认 https://open.apipost.net。
 */

class ApipostAPIError extends Error {
  constructor(code, msg, envelope) {
    super(msg || `业务错误 code=${code}`);
    this.name = 'ApipostAPIError';
    this.code = code;
    this.envelope = envelope;
  }
}

class Client {
  constructor({ token, host, timeout = 30000 }) {
    if (!token) {
      throw new Error(
        '缺少 api-token：请用 --token 或环境变量 APIPOST_TOKEN 提供。\n' +
          '获取方式：Apipost 客户端 → 工作台 → 项目设置 → 对外能力 → open API'
      );
    }
    this.token = token;
    this.host = (host || 'https://open.apipost.net').replace(/\/+$/, '');
    this.timeout = timeout;
  }

  /**
   * 按 spec + 已提供的 query 参数构造完整 URL。
   * 只发送用户显式提供的参数；带默认值的参数（如 action=0）在未提供时补默认值。
   * 绝不把文档里的示例 ID 当固定值发出。
   */
  buildUrl(spec, params = {}) {
    let path = spec.path;
    for (const pp of spec.pathParams || []) {
      path = path.replace(`{${pp.name}}`, encodeURIComponent(params[pp.name] ?? ''));
    }
    const qs = [];
    for (const q of spec.query || []) {
      const val = params[q.name];
      if (val !== undefined && val !== null && val !== '') {
        qs.push(`${q.name}=${encodeURIComponent(val)}`);
      } else if (q.hasDefault && q.default !== undefined && q.default !== null) {
        qs.push(`${q.name}=${encodeURIComponent(q.default)}`);
      }
    }
    return this.host + path + (qs.length ? '?' + qs.join('&') : '');
  }

  async request(spec, { query = {}, body } = {}) {
    const url = this.buildUrl(spec, query);
    const headers = { 'api-token': this.token, 'Content-Type': 'application/json' };
    const opts = { method: spec.method, headers };
    if (body !== undefined && body !== null) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let res;
    try {
      res = await fetch(url, { ...opts, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const reason = e.name === 'AbortError' ? `请求超时（>${this.timeout}ms）` : e.message;
      throw new Error(`网络请求失败：${reason}`);
    }
    clearTimeout(timer);

    const text = await res.text();
    let envelope = null;
    try {
      envelope = JSON.parse(text);
    } catch {
      envelope = { _raw: text };
    }
    return { httpStatus: res.status, envelope };
  }
}

module.exports = { Client, ApipostAPIError };
