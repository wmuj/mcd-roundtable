'use strict';
/**
 * 极简 MCP (Streamable HTTP) 客户端 —— 零依赖。
 * 仅实现本项目需要的部分：initialize + tools/call。
 */
const ENDPOINT = process.env.MCD_MCP_URL || 'https://mcp.mcd.cn';

let _idSeq = 1;

async function rpc(token, method, params, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _idSeq++,
        method,
        params: params || {},
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`MCP 请求超时（${timeoutMs}ms）：${ENDPOINT}`);
    throw new Error(`MCP 网络错误：${e.message}（请检查网络/代理）`);
  }
  clearTimeout(timer);

  if (res.status === 401) throw new Error('MCP Token 无效或已过期（HTTP 401）。请到 https://open.mcd.cn/mcp 重新获取。');
  if (res.status === 429) throw new Error('MCP 限流中（HTTP 429，600次/分钟）。请稍等片刻再试。');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MCP HTTP ${res.status}：${body.slice(0, 200)}`);
  }

  const raw = await res.text();
  // 兼容 SSE（data: {...}）与纯 JSON 两种返回
  let line = raw.trim();
  if (!line.startsWith('{')) {
    const hit = raw.split('\n').filter((l) => l.startsWith('data:')).pop();
    if (!hit) throw new Error(`MCP 返回格式异常：${raw.slice(0, 200)}`);
    line = hit.slice(5).trim();
  }
  const msg = JSON.parse(line);
  if (msg.error) {
    throw new Error(`MCP 错误 ${msg.error.code || ''}：${msg.error.message || 'unknown'}`);
  }
  return msg.result;
}

async function init(token) {
  await rpc(token, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'mcd-roundtable', version: '1.0.0' },
  });
}

/** 调用 MCP 工具，返回 content 数组 */
async function callTool(token, name, args) {
  const result = await rpc(token, 'tools/call', { name, arguments: args || {} });
  if (result.isError) {
    const t = (result.content || []).map((c) => c.text || '').join(' ');
    throw new Error(`工具 ${name} 执行失败：${t.slice(0, 200)}`);
  }
  return result.content || [];
}

/** 调用工具并尽力提取结构化 JSON（麦当劳工具把原始 JSON 附在文本末尾） */
async function callToolJson(token, name, args) {
  const content = await callTool(token, name, args);
  const text = content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  const p = text.indexOf('{"success"');
  if (p >= 0) {
    // 从 {"success" 开始做一次括号配平，容忍文本尾部夹杂说明
    const dec = new jsonDecoder(text, p);
    const obj = dec.tryParse();
    if (obj) return obj;
  }
  return null;
}

/** 手写 JSON 括号配平解析器（处理字符串内的引号/转义） */
function jsonDecoder(text, start) {
  return {
    tryParse() {
      let i = start, depth = 0, inStr = false, esc = false;
      while (i < text.length) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
          }
        }
        i++;
      }
      return null;
    },
  };
}

module.exports = { init, callTool, callToolJson, ENDPOINT };
