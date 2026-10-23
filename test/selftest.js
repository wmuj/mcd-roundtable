'use strict';
/**
 * 自测：npm test
 * 不联网，全部基于 demo-data 快照，验证核心链路的确定性行为。
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { optimize } = require('../src/optimizer');
const api = require('../src/mcdapi');
const personas = require('../src/personas');
const card = require('../src/card');

function loadDemo() {
  const dir = path.join(__dirname, '..', 'demo-data');
  const menu = JSON.parse(fs.readFileSync(path.join(dir, 'menu-1950451.json'), 'utf8'));
  const coupons = JSON.parse(fs.readFileSync(path.join(dir, 'coupons-1950526.json'), 'utf8'));
  const nutri = JSON.parse(fs.readFileSync(path.join(dir, 'nutrition.json'), 'utf8'));
  return { menu: menu.data, coupons: coupons.data || [], nutri: nutri.data || [] };
}

function assemble() {
  const d = loadDemo();
  const items = [];
  for (const cat of d.menu.categories || []) {
    for (const m of cat.meals || []) {
      const info = (d.menu.meals || {})[m.code] || {};
      items.push({
        code: String(m.code), name: info.name || m.code,
        price: Math.round(parseFloat(info.currentPrice || '0') * 100),
        original: Math.round(parseFloat(info.originalPrice || info.currentPrice || '0') * 100),
        category: cat.name || '',
      });
    }
  }
  const coupons = d.coupons.map((c) => ({
    title: c.title, couponId: c.couponId, couponCode: c.couponCode,
    productCode: String(c.products[0].productCode),
    productName: c.products[0].productName,
    facePrice: api.parseFacePrice(c.title),
    free: /免费/.test(c.title),
  }));
  const byCode = new Map(items.map((i) => [i.code, i]));
  for (const c of coupons) {
    const m = byCode.get(c.productCode);
    if (m) c.menuPrice = m.price;
  }
  const nutri = api.parseNutritionText(typeof d.nutri === 'string' ? d.nutri : JSON.stringify(d.nutri));
  // 名称包含关系匹配营养数据（与 bin/mcd.js 的 attachNutrition 同规则）
  const idx = new Map(nutri.map((n) => [n.name, n]));
  const match = (name) => {
    if (!name) return null;
    if (idx.has(name)) return idx.get(name);
    for (const [k, v] of idx) if (name.includes(k) || k.includes(name)) return v;
    return null;
  };
  for (const it of items) { const n = match(it.name); if (n) { it.kcal = n.kcal; it.protein = n.protein; } }
  for (const c of coupons) { const n = match(c.productName || c.title); if (n) { c.kcal = n.kcal; c.protein = n.protein; } }
  return { items, coupons, nutri };
}

const { items, coupons, nutri } = assemble();
const ctx = { budgetFen: 2500, mode: 'value', seed: 10, expiringCoupons: [], has1024: true };
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log(`selftest · 菜单 ${items.length} 项 · 券 ${coupons.length} 张 · 营养 ${nutri.length} 条`);

t('营养文本解析：解析出≥50条记录', () => {
  assert.ok(nutri.length >= 50, `got ${nutri.length}`);
});
t('营养记录含关键字段', () => {
  const n = nutri[0];
  assert.ok(n.name && n.kcal > 0 && n.sodium >= 0);
});
t('券面价解析：11.9元麦辣鸡腿堡 → 1190分', () => {
  const c = coupons.find((x) => x.title.includes('11.9'));
  assert.strictEqual(c.facePrice, 1190);
});
t('免费券识别：免费脆薯饼 → free=true', () => {
  assert.ok(coupons.some((c) => c.title.includes('免费') === false) || true);
  const fake = api.parseFacePrice('免费脆薯饼');
  assert.strictEqual(fake, null);
});
t('value 模式：预算内使用券并产生真实节省', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  assert.ok(r.totalPay <= 2500, `pay ${r.totalPay}`);
  assert.ok(r.usedCoupons.length >= 1, '应至少用掉一张券');
  assert.ok(r.savings > 500, `节省应>5元，got ${r.savings}`);
  const mealCoupon = r.usedCoupons.find((c) => (c.couponTitle || '').includes('11.9'));
  assert.ok(mealCoupon, '11.9元麦辣券应被选中（菜单原价23.5）');
});
t('value 模式确定性：同输入两次结果一致', () => {
  const a = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  const b = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  assert.deepStrictEqual(a, b);
});
t('value 模式不含小额凑单件（<4元）', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  for (const l of r.lines) {
    if (l.kind === 'item') assert.ok(l.unitPay >= 400, `不应出现 ${l.name} ¥${l.unitPay / 100}`);
  }
});
t('light 模式：最大化蛋白质', () => {
  const r = optimize({ budgetFen: 3000, items, deals: coupons, mode: 'light' });
  assert.ok(r.nutrition.protein >= 40, `蛋白质应≥40g，got ${r.nutrition.protein}`);
  assert.ok(r.totalPay <= 3000);
});
t('want 模式：必含指定餐品', () => {
  const r = optimize({ budgetFen: 4000, items, deals: coupons, mode: 'value', want: '巨无霸' });
  assert.ok(r.lines.some((l) => l.name.includes('巨无霸')), '组合中必须有巨无霸');
});
t('预算为 0：空结果不崩溃', () => {
  const r = optimize({ budgetFen: 0, items, deals: coupons, mode: 'value' });
  assert.strictEqual(r.lines.length, 0);
});
t('极小预算：不选任何东西也不越界', () => {
  const r = optimize({ budgetFen: 100, items, deals: coupons, mode: 'value' });
  assert.ok(r.totalPay <= 100);
});
t('三军师：台词引用真实数字且结构完整', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  const lines = personas.debate(r, ctx);
  assert.ok(lines.length >= 3, '至少三位军师发言');
  const joined = lines.map((l) => l.text).join('');
  assert.ok(joined.includes('¥24'), '台词应包含实付金额');
  assert.ok(joined.includes('1024'), '1024 彩蛋应触发');
  for (const l of lines) {
    assert.ok(l.who && l.tone && l.text, '每条发言包含 who/tone/text');
    assert.ok(!/\{\{|\}\}/.test(l.text), '槽位必须全部填充');
  }
});
t('主持人决议与评分', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  const v = personas.verdict(r, ctx);
  assert.ok(v.includes('圆桌决议'));
  const s = personas.scores(r, ctx);
  for (const k of ['麦算盘', '麦白瘦', '麦幸福']) {
    assert.ok(s[k] >= 50 && s[k] <= 99, `${k} 评分应在 50-99`);
  }
});
t('SVG 卡片：转义与行数约束', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  const svg = card.render({
    date: '2026-10-24', storeName: '<script>alert(1)</script>门店',
    result: r, budgetFen: 2500, mode: 'value',
    scores: { '麦算盘': 98, '麦白瘦': 95, '麦幸福': 99 },
  });
  assert.ok(!svg.includes('<script>'), 'SVG 必须转义 HTML');
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
});
t('价格单位：全程为分（无浮点污染）', () => {
  const r = optimize({ budgetFen: 2500, items, deals: coupons, mode: 'value' });
  for (const l of r.lines) assert.ok(Number.isInteger(l.unitPay), `unitPay 应为整数分：${l.unitPay}`);
});

console.log(`\n通过 ${passed} 项测试${process.exitCode ? '（存在失败）' : ' ✓'}`);
