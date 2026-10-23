'use strict';
/**
 * 终端 UI：零依赖 ANSI 渲染。金拱门配色：金黄 #FFC72C / 麦红 #DA291C。
 * NO_COLOR 或非 TTY 时自动降级为纯文本。
 */
const noColor = !process.env.FORCE_COLOR && (process.env.NO_COLOR || !process.stdout.isTTY);

function c(code, s) {
  return noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
}
const GOLD = (s) => c('38;5;220', s);
const RED = (s) => c('38;5;203', s);
const GREY = (s) => c('38;5;245', s);
const GREEN = (s) => c('38;5;114', s);
const BOLD = (s) => c('1', s);
const DIM = (s) => c('2', s);

function width(s) {
  // 中文按 2 列算
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
  return w;
}

function pad(s, n) {
  const gap = n - width(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function box(lines, opts = {}) {
  const inner = opts.width || Math.max(...lines.map((l) => width(l))) + 4;
  const top = '╭' + '─'.repeat(inner) + '╮';
  const bot = '╰' + '─'.repeat(inner) + '╯';
  const mid = lines.map((l) => '│ ' + pad(l, inner - 3) + ' │').join('\n');
  return top + '\n' + mid + '\n' + bot;
}

function banner() {
  const art = [
    '  ███╗   ███╗ ██████╗██████╗ ',
    '  ████╗ ████║██╔════╝██╔══██╗',
    '  ██╔████╔██║██║     ██║  ██║',
    '  ██║╚██╔╝██║██║     ██║  ██║',
    '  ██║ ╚═╝ ██║╚██████╗██████╔╝',
    '  ╚═╝     ╚═╝ ╚═════╝╚═════╝ ',
  ];
  const title = '麦 门 圆 桌 · McRoundTable';
  const sub = '三个AI军师 × 你的真实优惠券 = 今晚最优的一顿麦当劳';
  const out = [];
  out.push(RED(art.join('\n')));
  out.push(GOLD(BOLD('  ' + title)) + '   ' + DIM('v1.0.0'));
  out.push(GREY('  ' + sub));
  out.push('');
  return out.join('\n');
}

function section(title) {
  return '\n' + GOLD(BOLD(`◆ ${title}`)) + ' ' + DIM('·'.repeat(Math.max(2, 46 - width(title))));
}

function kv(k, v) {
  return '  ' + GREY(pad(k + '：', 16)) + v;
}

/** 辩论场景渲染 */
function renderDebate(lines) {
  const colors = { '麦算盘': GOLD, '麦白瘦': GREEN, '麦幸福': RED };
  return lines.map((l) => {
    const who = (colors[l.who] || GOLD)(BOLD(`【${l.who}·${l.tone}】`));
    return ` ${who}\n ${l.text}\n`;
  }).join('\n');
}

function renderVerdict(r, ctx, scores) {
  const out = [];
  out.push(section('圆桌决议'));
  out.push('');
  for (const l of r.lines) {
    const tag = l.kind === 'deal' ? RED(`[券 ${l.couponTitle}]`) : GREY(`[${l.category}]`);
    const pay = l.unitPay === 0 ? GREEN('免费') : GOLD(`¥${(l.unitPay / 100).toFixed(2)}`);
    out.push(`  ${pad(l.name, 30)} ×${l.qty}  ${pay}  ${tag}`);
  }
  out.push('  ' + DIM('─'.repeat(52)));
  out.push(`  ${BOLD('实付')} ${GOLD(BOLD(`¥${(r.totalPay / 100).toFixed(2)}`))} / 预算 ¥${(ctx.budgetFen / 100).toFixed(2)}   ${r.savings > 0 ? `${GREEN(`省 ¥${(r.savings / 100).toFixed(2)}（${r.savingsPct}%）`)}` : ''}`);
  if (r.nutrition.kcal) {
    out.push(`  ${GREY('营养')} 约 ${r.nutrition.kcal} 大卡${r.nutrition.protein ? ` · 蛋白质 ${r.nutrition.protein}g` : ''}`);
  }
  if (scores) {
    const s = Object.entries(scores).map(([k, v]) => `${k} ${v}分`).join('  ');
    out.push(`  ${GREY('评分')} ${s}`);
  }
  return out.join('\n');
}

function errorBox(msg, hint) {
  const lines = [RED(BOLD('✗ ' + msg))];
  if (hint) lines.push(GREY(hint));
  return box(lines);
}

module.exports = { banner, section, kv, renderDebate, renderVerdict, errorBox, GOLD, RED, GREY, GREEN, BOLD, DIM, box, pad, width, yuanNotNeeded: true };
