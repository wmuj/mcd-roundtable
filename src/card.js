'use strict';
/**
 * SVG 战报卡片生成 —— 可直接提交到仓库并嵌入 GitHub Profile README：
 *   <img src="mcd-card.svg">
 * 每天跑一次（可用附带 GitHub Action），Profile 上的麦门战报永远新鲜。
 */
const { yuan } = require('./personas');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 截断到最大显示宽度（近似中文 2:1） */
function clip(s, maxCols) {
  let w = 0, out = '';
  for (const ch of String(s)) {
    const cw = ch.codePointAt(0) > 0x2e7f ? 2 : 1;
    if (w + cw > maxCols) return out + '…';
    w += cw; out += ch;
  }
  return out;
}

function render({ date, storeName, result, budgetFen, mode, scores, repo }) {
  const W = 640, H = 360;
  const comboRows = result.lines.slice(0, 4).map((l, i) => {
    const name = clip(l.name + (l.qty > 1 ? ` ×${l.qty}` : ''), 18);
    const price = l.unitPay === 0 ? '免费' : `¥${yuan(l.unitPay)}`;
    const y = 128 + i * 30;
    const coupon = l.kind === 'deal'
      ? `<text x="588" y="${y}" text-anchor="end" font-size="11" fill="#ff9d66">券</text>`
      : '';
    return `<text x="44" y="${y}" font-size="14" fill="#f5efe0" font-family="PingFang SC,Microsoft YaHei,sans-serif">${esc(name)}</text>
    <text x="330" y="${y}" font-size="13" fill="#ffc72c" font-family="ui-monospace,Consolas,sans-serif">${esc(price)}</text>${coupon}`;
  }).join('\n    ');
  const more = result.lines.length > 4
    ? `<text x="44" y="${128 + 4 * 30}" font-size="12" fill="#8a8578">…共 ${result.lines.length} 项</text>`
    : '';

  const kcal = result.nutrition.kcal ? `${result.nutrition.kcal} kcal` : '—';
  const scoreRow = scores
    ? Object.entries(scores).map(([k, v], i) => {
        const x = 44 + i * 150;
        const color = ['#ffc72c', '#7dd97b', '#ff6f5e'][i];
        return `<text x="${x}" y="286" font-size="13" fill="#8a8578" font-family="PingFang SC,Microsoft YaHei,sans-serif">${esc(k)}</text>
    <text x="${x + 62}" y="286" font-size="16" fill="${color}" font-weight="bold" font-family="ui-monospace,Consolas,sans-serif">${v}分</text>`;
      }).join('\n    ')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141414"/><stop offset="1" stop-color="#0a0a0a"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd75e"/><stop offset="1" stop-color="#f5a800"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="15" fill="none" stroke="#ffc72c" stroke-opacity="0.45" stroke-width="1.5"/>

  <!-- 金拱门 M -->
  <path d="M 44 62 C 44 30 74 30 78 52 C 82 30 112 30 112 62 L 112 74 L 100 74 L 100 60 C 100 44 86 44 84 60 L 84 74 L 72 74 L 72 60 C 70 44 56 44 56 60 L 56 74 L 44 74 Z" fill="url(#gold)"/>

  <text x="132" y="52" font-size="20" font-weight="bold" fill="#ffc72c" font-family="PingFang SC,Microsoft YaHei,sans-serif">麦门圆桌 · 今日战报</text>
  <text x="132" y="74" font-size="12" fill="#8a8578" font-family="PingFang SC,Microsoft YaHei,sans-serif">${esc(date)} · ${esc(clip(storeName || '圆桌会议', 22))} · ${mode === 'light' ? '轻食模式' : '价值模式'}</text>

  <line x1="44" y1="96" x2="${W - 44}" y2="96" stroke="#333" stroke-width="1"/>
  ${comboRows}
  ${more}

  <text x="44" y="246" font-size="13" fill="#8a8578" font-family="PingFang SC,Microsoft YaHei,sans-serif">实付</text>
  <text x="92" y="250" font-size="30" font-weight="bold" fill="#ffc72c" font-family="ui-monospace,Consolas,sans-serif">¥${yuan(result.totalPay)}</text>
  <text x="222" y="250" font-size="13" fill="#8a8578" font-family="PingFang SC,Microsoft YaHei,sans-serif">/ 预算 ¥${yuan(budgetFen)}</text>
  ${result.savings > 0 ? `<text x="380" y="250" font-size="15" fill="#7dd97b" font-weight="bold" font-family="ui-monospace,Consolas,sans-serif">省 ¥${yuan(result.savings)}（${result.savingsPct}%）</text>` : ''}
  <text x="560" y="250" font-size="13" fill="#8a8578" font-family="ui-monospace,Consolas,sans-serif">${esc(kcal)}</text>

  ${scoreRow}
  <text x="44" y="330" font-size="11" fill="#5b574d" font-family="PingFang SC,Microsoft YaHei,sans-serif">三军师 × 麦当劳 MCP 真实数据裁决 · 以官方 App 实时结果为准</text>
  <text x="${W - 44}" y="330" text-anchor="end" font-size="11" fill="#5b574d" font-family="ui-monospace,Consolas,sans-serif">${esc(repo || 'github.com/wmuj/mcd-roundtable')}</text>
</svg>
`;
}

module.exports = { render };
