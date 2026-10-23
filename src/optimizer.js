'use strict';
/**
 * 确定性组合优化器 —— 预算内的 0/1 背包（普通商品最多买 2 份，拆成两件 0/1）。
 * 目标：
 *  - value 模式：预算内最大化「吃到的东西的原价价值」（券 = 高价值密度项，天然优先）
 *  - light 模式：预算内最大化蛋白质（轻食向）
 * 金额单位一律「分」。所有输入均为真实 MCP 数据；无 LLM、无随机数，
 * 同样输入必得同样输出 —— 算术交给代码，可复现、可审计。
 */

const MAX_BUDGET_FEN = 30000; // DP 上限 300 元，防内存膨胀
const MAX_QTY_PER_ITEM = 2;

function clean(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').trim();
}

function optimize({ budgetFen, items, deals, mode = 'value', want = null }) {
  budgetFen = Math.min(Math.floor(budgetFen), MAX_BUDGET_FEN);
  if (budgetFen <= 0) return emptyResult();

  // --- 构造 0/1 候选池 ---
  // 普通商品：{pay, value, name, code, kind:'item', kcal, protein}
  // 券商品：  {pay=facePrice, value=menuPrice||facePrice, name, code:productCode, kind:'deal', couponCode}
  const pool = [];
  for (const it of items) {
    // 价值模式下排除小额加购（酱料/小食凑单件），避免"两管芥末凑预算"的退化解
    if (it.price > 0 && it.price < 400) continue;
    for (let q = 0; q < MAX_QTY_PER_ITEM; q++) {
      pool.push({
        kind: 'item',
        code: it.code,
        name: clean(it.name),
        category: clean(it.category),
        pay: it.price,
        value: Math.max(it.original || it.price, it.price),
        kcal: it.kcal || null,
        protein: it.protein || null,
        wantHit: want ? it.name.includes(want) : false,
      });
    }
  }
  for (const d of deals) {
    if (!d.facePrice && !d.free) continue; // 没有券面价又非免费券，无法核价则跳过
    pool.push({
      kind: 'deal',
      code: d.productCode,
      name: clean(d.productName || d.title),
      category: '优惠券',
      pay: d.free ? 0 : d.facePrice,
      // 券的价值 = 不用券时的菜单价；查不到时免费券按 8 元保守估计，其余按券面价
      value: d.menuPrice ? d.menuPrice : (d.free ? 800 : d.facePrice),
      kcal: d.kcal || null,
      protein: d.protein || null,
      couponCode: d.couponCode,
      couponTitle: clean(d.title),
      wantHit: want ? (d.productName || d.title).includes(want) : false,
    });
  }

  const wantItems = want ? pool.filter((p) => p.wantHit) : [];
  // 指定想吃：预算先扣掉最便宜的一个命中项
  let forced = null;
  if (want && wantItems.length) {
    forced = wantItems.reduce((a, b) => (a.pay <= b.pay ? a : b));
    budgetFen -= forced.pay;
    if (budgetFen < 0) return emptyResult();
  }

  // DP 候选：排除 forced 的第一份
  const cand = [];
  let forcedSkipped = false;
  for (const p of pool) {
    if (forced && p === forced && !forcedSkipped) { forcedSkipped = true; continue; }
    if (p.pay > budgetFen) continue;
    cand.push(p);
  }

  const valueFn = mode === 'light' ? proteinValue : (p) => p.value - (p.kind === 'item' ? 1 : 0);
  let { best, take, prevState } = knapsack(cand, budgetFen, valueFn);

  // 轻食模式兜底：营养数据缺失导致无可选时，退回价值模式
  if (mode === 'light' && best.value <= 0) {
    const alt = knapsack(cand, budgetFen, (p) => p.value - (p.kind === 'item' ? 1 : 0));
    best = alt.best; take = alt.take; prevState = alt.prevState;
  }

  // 回溯
  const picks = [];
  let s = best.state;
  for (let i = cand.length - 1; i >= 0; i--) {
    const t = take[i];
    if (t && t[s]) {
      picks.push(cand[i]);
      s = prevState[i][s];
    }
  }
  picks.reverse();

  if (forced) picks.unshift(forced);

  return summarize(picks, mode);
}

/** 0/1 背包，返回最优解状态与重建表 */
function knapsack(cand, budget, valueFn) {
  const N = budget + 1;
  const NEG = -1;
  const dp = new Float64Array(N).fill(0);
  const take = [];
  const prevState = [];
  let bestState = 0, bestVal = 0;

  for (let i = 0; i < cand.length; i++) {
    const p = cand[i];
    const v = valueFn(p);
    if (v <= 0) { take.push(null); prevState.push(null); continue; }
    const tRow = new Uint8Array(N);
    const pRow = new Int32Array(N).fill(-1);
    let changed = false;
    for (let s = N - 1; s >= p.pay; s--) {
      const candVal = dp[s - p.pay] + v;
      if (candVal > dp[s] + 1e-9) {
        dp[s] = candVal;
        tRow[s] = 1;
        pRow[s] = s - p.pay;
        changed = true;
      }
    }
    // 记录当前最优
    if (dp[N - 1] > bestVal + 1e-9) { bestVal = dp[N - 1]; bestState = N - 1; }
    // 也可能在中间状态最优（预算没用满时 value 未必最大在 N-1）——单值 DP 中 dp 单调不减，
    // 最大值总在 N-1，但 pay=0 项会平铺。用 N-1 即可。
    take.push(tRow);
    prevState.push(pRow);
    if (!changed) { /* 该项未改善任何状态 */ }
  }
  // dp[N-1] 就是 bestVal（dp 单调）
  return { best: { state: N - 1, value: dp[N - 1] }, take, prevState };
}

function proteinValue(p) {
  // 轻食模式只认真实营养数据，不虚构（无数据的项蛋白质记 0）；
  // 同等蛋白质时用微小的价格负项偏好更便宜的方案
  return p.protein ? p.protein - p.pay / 100000 : 0;
}

function summarize(picks, mode) {
  // 合并同类
  const merged = new Map();
  for (const p of picks) {
    const key = p.kind + ':' + p.code + ':' + (p.couponCode || '');
    if (!merged.has(key)) {
      merged.set(key, {
        kind: p.kind, code: p.code, name: p.name, category: p.category,
        qty: 0, unitPay: p.pay, unitValue: p.value,
        couponCode: p.couponCode || null, couponTitle: p.couponTitle || null,
        kcal: p.kcal, protein: p.protein,
      });
    }
    merged.get(key).qty++;
  }
  const lines = [...merged.values()];
  const totalPay = picks.reduce((a, p) => a + p.pay, 0);
  const totalValue = picks.reduce((a, p) => a + (p.value || p.pay), 0);
  const kcal = picks.reduce((a, p) => a + (p.kcal || 0), 0);
  const protein = picks.reduce((a, p) => a + (p.protein || 0), 0);
  const usedCoupons = lines.filter((l) => l.kind === 'deal');
  return {
    lines,
    totalPay,
    totalValue: Math.max(totalValue, totalPay),
    savings: Math.max(0, Math.max(totalValue, totalPay) - totalPay),
    savingsPct: totalValue > 0 ? Math.round(((totalValue - totalPay) / totalValue) * 100) : 0,
    usedCoupons,
    nutrition: { kcal: kcal || null, protein: Math.round(protein * 10) / 10 || null },
    mode,
  };
}

function emptyResult() {
  return {
    lines: [], totalPay: 0, totalValue: 0, savings: 0, savingsPct: 0,
    usedCoupons: [], nutrition: { kcal: null, protein: null }, mode: 'value',
  };
}

module.exports = { optimize };
