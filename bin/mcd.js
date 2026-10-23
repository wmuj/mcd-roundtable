#!/usr/bin/env node
'use strict';
/**
 * 麦门圆桌 · McRoundTable CLI
 *
 * 用法：
 *   mcd-roundtable --budget 25 [--city 北京 --keyword 王府井] [--store 1950526]
 *                  [--mode value|light] [--want 巨无霸] [--card out.svg]
 *                  [--daily] [--claim] [--demo] [--json] [--seed 7]
 * 环境变量：
 *   MCD_MCP_TOKEN=你的麦当劳MCP Token（https://open.mcd.cn/mcp 申请）
 */
const fs = require('fs');
const path = require('path');
const mcp = require('../src/mcp');
const api = require('../src/mcdapi');
const { optimize } = require('../src/optimizer');
const personas = require('../src/personas');
const ui = require('../src/ui');
const daily = require('../src/daily');
const card = require('../src/card');

function parseArgs(argv) {
  const a = {
    budget: 25, mode: 'value', city: '北京', keyword: '', store: null,
    want: null, card: null, daily: false, claim: false, demo: false,
    json: false, seed: null, citySet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--budget' || k === '-b') a.budget = parseFloat(next());
    else if (k === '--mode' || k === '-m') a.mode = next();
    else if (k === '--city') { a.city = next(); a.citySet = true; }
    else if (k === '--keyword' || k === '-k') a.keyword = next();
    else if (k === '--store' || k === '-s') a.store = next();
    else if (k === '--want' || k === '-w') a.want = next();
    else if (k === '--card') a.card = next();
    else if (k === '--daily') a.daily = true;
    else if (k === '--claim') a.claim = true;
    else if (k === '--demo') a.demo = true;
    else if (k === '--json') a.json = true;
    else if (k === '--seed') a.seed = parseInt(next(), 10);
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k === 'daily') a.daily = true; // 位置参数命令
    else if (k === 'demo') a.demo = true;
  }
  if (a.budget <= 0) a.budget = 25;
  if (a.mode !== 'light') a.mode = 'value';
  return a;
}

function help() {
  return `麦门圆桌 · McRoundTable —— 三个AI军师用你的真实优惠券，吵出今晚最优的一顿麦当劳

用法：
  node bin/mcd.js [命令] [选项]

选项：
  -b, --budget <元>     预算（默认 25）
  -s, --store <编号>    指定门店 storeCode（默认自动搜索）
      --city <城市>     门店搜索城市（默认北京）
  -k, --keyword <词>    门店搜索关键词（如 王府井 / 机场）
  -m, --mode <模式>     value=预算内价值最大化（默认）| light=蛋白质优先
  -w, --want <词>       必须包含的餐品关键词（如 巨无霸）
      --card <文件>     生成 SVG 战报卡片（可嵌入 GitHub Profile README）
      --daily           今日麦门情报（积分/券到期/活动）
      --claim           一键领取麦麦省所有可领券
      --demo            离线演示模式（内置真实数据快照，无需 Token）
      --json            以 JSON 输出结果
      --seed <n>        固定军师语录随机种子
  -h, --help            帮助

环境变量：
  MCD_MCP_TOKEN  麦当劳 MCP Token，在 https://open.mcd.cn/mcp 申请

示例：
  MCD_MCP_TOKEN=xxx npx mcd-roundtable --budget 20 --city 上海 --keyword 南京西路
  MCD_MCP_TOKEN=xxx npx mcd-roundtable --budget 30 --want 巨无霸 --card card.svg
  npx mcd-roundtable --demo            # 无 Token 先看效果`;
}

/* ---------------- 演示数据 ---------------- */
function loadDemo() {
  const dir = path.join(__dirname, '..', 'demo-data');
  const menu = JSON.parse(fs.readFileSync(path.join(dir, 'menu-1950451.json'), 'utf8'));
  const coupons = JSON.parse(fs.readFileSync(path.join(dir, 'coupons-1950526.json'), 'utf8'));
  const nutri = JSON.parse(fs.readFileSync(path.join(dir, 'nutrition.json'), 'utf8'));
  return { menu: menu.data, coupons: coupons.data || [], nutri: nutri.data || [] };
}

/* ---------------- 数据装配 ---------------- */
/** 把营养表按名称包含关系挂到 items / deals 上 */
function attachNutrition(items, deals, nutri) {
  const idx = new Map();
  for (const n of nutri) idx.set(n.name, n);
  const match = (name) => {
    if (!name) return null;
    if (idx.has(name)) return idx.get(name);
    for (const [k, v] of idx) {
      if (name.includes(k) || k.includes(name)) return v;
    }
    return null;
  };
  for (const it of items) {
    const n = match(it.name);
    if (n) { it.kcal = n.kcal; it.protein = n.protein; }
  }
  for (const d of deals) {
    const n = match(d.productName || d.title);
    if (n) { d.kcal = n.kcal; d.protein = n.protein; }
  }
}

/** 券关联菜单价（券商品若在菜单里，则知原价） */
function enrichDeals(deals, items) {
  const byCode = new Map(items.map((i) => [i.code, i]));
  for (const d of deals) {
    const m = byCode.get(d.productCode);
    if (m) d.menuPrice = m.price;
  }
}

async function realData(args) {
  const token = process.env.MCD_MCP_TOKEN;
  if (!token) {
    console.error(ui.errorBox('未设置 MCD_MCP_TOKEN 环境变量', '到 https://open.mcd.cn/mcp 申请 Token 后：\n  export MCD_MCP_TOKEN=你的Token\n或先用演示模式：npx mcd-roundtable --demo'));
    process.exit(2);
  }
  await mcp.init(token);

  if (args.claim) {
    const t = await api.text(token, 'auto-bind-coupons', {});
    const n = (t.match(/领取成功/g) || []).length;
    console.log(ui.GREEN(`✓ 一键领券完成${n ? `，涉及 ${n} 张` : ''}。打开麦当劳 App 卡包查看。`));
  }
  if (args.daily) {
    console.log(await daily.daily(token));
    return;
  }

  // 门店解析
  let store = null;
  if (args.store) {
    store = { storeCode: String(args.store), storeName: `门店 ${args.store}` };
  } else {
    const kw = args.keyword || (args.citySet ? '' : '王府井');
    const stores = await api.nearbyStores(token, { city: args.city, keyword: kw });
    if (!stores.length) {
      console.error(ui.errorBox(`没找到门店（city=${args.city}${kw ? ` keyword=${kw}` : ''}）`, '试试 --city 上海 --keyword 机场，或 --store 直接指定门店编号'));
      process.exit(3);
    }
    store = stores.find((s) => s.businessStatus) || stores[0];
  }

  const [menu, coupons, nutri, acc] = await Promise.all([
    api.meals(token, store.storeCode),
    api.storeCoupons(token, store.storeCode),
    api.nutrition(token).catch(() => []),
    api.myAccount(token).catch(() => null),
  ]);

  if (!menu || !menu.length) {
    console.error(ui.errorBox('拿不到菜单（门店可能已打烊）', '换一家 24 小时店试试：--keyword 机场\n或者先看演示：npx mcd-roundtable --demo'));
    process.exit(3);
  }
  enrichDeals(coupons, menu);
  attachNutrition(menu, coupons, nutri);

  return { store, menu, coupons, nutri, account: acc, demo: false };
}

function demoData(args) {
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
    validTime: c.tradeDateTime || '',
    productCode: String(c.products[0].productCode),
    productName: c.products[0].productName,
    facePrice: api.parseFacePrice(c.title),
    free: /免费/.test(c.title),
  }));
  enrichDeals(coupons, items);
  const nutri = api.parseNutritionText(typeof d.nutri === 'string' ? d.nutri : JSON.stringify(d.nutri));
  attachNutrition(items, coupons, nutri);
  return {
    store: { storeCode: '1950526', storeName: '北京王府井（演示数据）' },
    menu: items, coupons, nutri: d.nutri,
    account: { availablePoint: '348.4', currentMouthExpirePoint: '0' },
    demo: true,
  };
}

/* ---------------- 主流程：圆桌 ---------------- */
async function roundtable(args) {
  const data = args.demo ? demoData(args) : await realData(args);
  if (!data) return;

  const budgetFen = Math.round(args.budget * 100);
  const seed = args.seed !== null ? args.seed : new Date().getDate() + new Date().getHours();

  const r = optimize({
    budgetFen, items: data.menu, deals: data.coupons,
    mode: args.mode, want: args.want,
  });

  if (!r.lines.length) {
    console.error(ui.errorBox('这个预算点不到任何东西（哪怕一张免费券都没匹配上）', '提高 --budget 或换个门店'));
    process.exit(4);
  }

  // 军师所需上下文
  let expiring = [];
  let has1024 = /1024/.test(JSON.stringify(data.coupons.map((c) => c.title)));
  if (!args.demo) {
    try { expiring = (await api.myCoupons(token0(), 1, 20)).expiringToday; } catch { /* 忽略 */ }
  }

  const ctx = {
    budgetFen, mode: args.mode, seed,
    storeName: data.store.storeName,
    points: data.account ? data.account.availablePoint : null,
    expiringCoupons: expiring, has1024,
  };
  const debateLines = personas.debate(r, ctx);
  const scores = personas.scores(r, ctx);
  const verdict = personas.verdict(r, ctx);

  if (args.json) {
    console.log(JSON.stringify({ result: r, scores, verdict, ctx }, null, 2));
  } else {
    console.log(ui.banner());
    console.log(ui.section(`第 ${dateTag()} 期 · ${data.store.storeName}`));
    console.log('');
    console.log(ui.renderDebate(debateLines));
    console.log(ui.renderVerdict(r, ctx, scores));
    console.log('');
    console.log(ui.GREY('  ' + verdict));
    if (data.demo) console.log(ui.GREY('  （演示模式：内置真实数据快照。接入你的 Token 可拉取实时菜单与券包）'));
    console.log('');
  }

  if (args.card) {
    const svg = card.render({
      date: dateTag(), storeName: data.store.storeName,
      result: r, budgetFen, mode: args.mode, scores,
      repo: 'github.com/wmuj/mcd-roundtable',
    });
    fs.writeFileSync(args.card, svg, 'utf8');
    if (!args.json) console.log(ui.GREEN(`✓ 战报卡片已生成：${args.card}（可提交到仓库并嵌入 Profile README）`));
  }
}

function dateTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function token0() { return process.env.MCD_MCP_TOKEN; }

/* ---------------- 入口 ---------------- */
(async () => {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(help()); process.exit(0); }
  try {
    await roundtable(args);
  } catch (e) {
    console.error(ui.errorBox(e.message));
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
})();
