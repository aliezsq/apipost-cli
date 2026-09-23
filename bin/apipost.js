#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { Client } = require('../lib/client');

const pkg = require('../package.json');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec.json'), 'utf8'));

const GROUP_DESC = {
  team: '团队管理',
  user: '用户模块',
  project: '项目管理',
  api: '接口模块',
  test: '自动化测试',
  model: '数据模型',
  attribute: '接口属性管理',
  mark: '接口状态管理',
  env: '环境管理',
  server: '服务管理',
  'global-param': '全局参数',
};

function toKebab(s) {
  return s.replace(/_/g, '-');
}
function toCamel(s) {
  return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// 全局 option：根命令 + 每个叶子子命令都挂一份，保证 --token 放前放后都能解析。
function addGlobalOpts(cmd) {
  cmd
    .option('-t, --token <token>', 'api-token（或环境变量 APIPOST_TOKEN）', process.env.APIPOST_TOKEN)
    .option('--host <url>', 'API 地址，含协议（默认 https://open.apipost.net）', process.env.APIPOST_HOST || 'https://open.apipost.net')
    .option('--json', '输出紧凑单行 JSON')
    .option('--unwrap', '只输出响应里的 data 字段')
    .option('--dry-run', '只打印将发出的请求，不实际发送')
    .option('--timeout <ms>', '请求超时毫秒数', '30000');
}

// 扁平 body 才推导标量 flag（值全为标量、无嵌套对象/数组）；复杂 body 只能走 --data。
function deriveScalarFlags(s) {
  if (s.bodyMode !== 'json' || !s.bodyExample) return [];
  let d;
  try {
    d = JSON.parse(s.bodyExample);
  } catch {
    return [];
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [];
  const keys = Object.keys(d);
  if (keys.some((k) => d[k] !== null && typeof d[k] === 'object')) return [];
  return keys.map((k) => ({
    name: k,
    type: typeof d[k] === 'number' ? 'number' : typeof d[k] === 'boolean' ? 'boolean' : 'string',
  }));
}

function coerce(v, type) {
  if (type === 'number') {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  if (type === 'boolean') return v === true || v === 'true' || v === '1';
  return v;
}

function parseData(v) {
  const raw = v.startsWith('@') ? fs.readFileSync(v.slice(1), 'utf8') : v;
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

const program = new Command();
program
  .name('apipost')
  .description('Apipost Open API V2 命令行客户端')
  .version(pkg.version);
addGlobalOpts(program);

const groups = new Map();
for (const [key, s] of Object.entries(spec)) {
  if (!groups.has(s.group)) {
    groups.set(
      s.group,
      program.command(s.group).description(GROUP_DESC[s.group] || s.group)
    );
  }
  const parent = groups.get(s.group);
  const leaf = parent
    .command(s.action)
    .description(`${s.name}${s.desc ? ' — ' + s.desc : ''}`);
  addGlobalOpts(leaf);

  const flagMap = {}; // camelFlag -> { name, kind, type }

  // query 参数 → flag
  for (const q of s.query || []) {
    const flag = toKebab(q.name);
    const camel = toCamel(flag);
    const hints = [];
    if (q.required) hints.push('必填');
    if (q.inCodePair) hints.push('与对应 id/code 二选一');
    if (q.hasDefault) hints.push(`默认 ${q.default}`);
    if (q.desc) hints.push(q.desc);
    const optDesc = hints.join('；');
    if (q.required) {
      leaf.requiredOption(`--${flag} <value>`, optDesc);
    } else if (q.hasDefault) {
      leaf.option(`--${flag} <value>`, optDesc, q.default);
    } else {
      leaf.option(`--${flag} <value>`, optDesc);
    }
    flagMap[camel] = { name: q.name, kind: 'query' };
  }

  // 扁平 body → 标量 flag（与 query 同名则跳过，避免冲突）
  const scalarFlags = deriveScalarFlags(s);
  const scalarNames = new Set(scalarFlags.map((f) => f.name));
  for (const f of scalarFlags) {
    const camel = toCamel(toKebab(f.name));
    if (flagMap[camel]) continue;
    leaf.option(`--${toKebab(f.name)} <value>`);
    flagMap[camel] = { name: f.name, kind: 'body', type: f.type };
  }

  // body --data（最高优先级）
  if (s.bodyMode === 'json') {
    leaf.option('--data <json|@file>', '请求体 JSON，或 @文件路径 读取文件（覆盖标量 flag）');
  }
  // api create --type
  if (s.typeFlag) {
    leaf.option(
      '--type <type>',
      '接口类型：目录|http|sse|markdown|tcp-client|websocket|tcp|socketio|graphql（默认 http）',
      'http'
    );
  }

  leaf.action(async (opts) => {
    try {
      await runCommand(s, opts, leaf.optsWithGlobals(), flagMap, scalarNames);
    } catch (e) {
      console.error(`错误: ${e.message}`);
      process.exitCode = e instanceof Error && e.code !== undefined ? 1 : 2;
    }
  });
}

async function runCommand(s, opts, globals, flagMap, scalarNames) {
  // 1) query 参数
  const query = {};
  const providedPair = [];
  for (const [camel, meta] of Object.entries(flagMap)) {
    if (meta.kind !== 'query') continue;
    const val = opts[camel];
    if (val !== undefined && val !== null && val !== '') {
      query[meta.name] = val;
      if ((s.query || []).find((q) => q.name === meta.name)?.inCodePair) {
        providedPair.push(meta.name);
      }
    }
  }
  const pairNames = (s.query || []).filter((q) => q.inCodePair).map((q) => q.name);
  if (pairNames.length && providedPair.length === 0) {
    throw new Error(`该接口需要提供 ${pairNames.join(' 或 ')} 之一`);
  }

  // 2) body（--data 最高优先级；否则由扁平标量 flag 组装）
  let body;
  if (opts.data !== undefined) {
    body = parseData(opts.data);
  } else {
    const b = {};
    let anyScalar = false;
    for (const [camel, meta] of Object.entries(flagMap)) {
      if (meta.kind !== 'body') continue;
      if (opts[camel] !== undefined && opts[camel] !== '') {
        b[meta.name] = coerce(opts[camel], meta.type);
        anyScalar = true;
      }
    }
    body = anyScalar ? b : undefined;
  }

  // 3) dry-run：只打印请求（api create 无 --data 时也允许，用于预览模板）
  if (globals.dryRun) {
    const probe = new Client({ token: globals.token || '<未提供>', host: globals.host });
    const req = {
      method: s.method,
      url: probe.buildUrl(s, query),
      headers: { 'api-token': globals.token ? '***' : '<未提供>', 'Content-Type': 'application/json' },
      body,
    };
    console.log(JSON.stringify(req, null, 2));
    const tpl = s.typeFlag && s.bodyTypes ? s.bodyTypes[opts.type] : s.bodyExample;
    if (tpl) {
      console.log('\n# 参考 body 示例：');
      console.log(tpl);
    }
    return;
  }

  // 4) 真实请求前的 body 校验（GET 不要求 body）
  if (s.typeFlag && body === undefined) {
    throw new Error(
      'api create 需要 --data 提供完整接口定义 JSON（--type 仅用于选择/预览模板，用 --dry-run 查看对应模板）'
    );
  }
  if (s.method !== 'GET' && s.bodyMode === 'json' && body === undefined) {
    throw new Error(
      `该接口需要请求体：请用 --data '<json>' 或 --data @file.json（用 --dry-run 查看 body 示例）`
    );
  }

  // 5) 真实请求
  const client = new Client({
    token: globals.token,
    host: globals.host,
    timeout: Number(globals.timeout),
  });
  const { httpStatus, envelope } = await client.request(s, { query, body });

  const out = globals.unwrap && envelope && typeof envelope === 'object' && envelope.data !== undefined
    ? envelope.data
    : envelope;
  console.log(globals.json ? JSON.stringify(out) : JSON.stringify(out, null, 2));

  // 5) 退出码：HTTP 非 2xx 或业务 code!=0 都算失败（失败也可能返回 HTTP 200）
  if (httpStatus >= 400) {
    console.error(`HTTP ${httpStatus}`);
    process.exitCode = 1;
  } else if (envelope && typeof envelope === 'object' && envelope.code !== undefined && envelope.code !== 0) {
    console.error(`业务错误 code=${envelope.code}: ${envelope.msg || ''}`);
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv).catch((e) => {
  console.error(`错误: ${e.message}`);
  process.exit(2);
});
