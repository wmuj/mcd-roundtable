'use strict';
/**
 * 麦当劳 MCP 工具封装层：把 35 个工具中本项目用到的 9 个，
 * 包装成带解析的函数。价格单位统一为「分」。
 */
const { callTool, callToolJson } = require('./mcp');

/** 普通文本结果 */
async function text(token, name, args) {
  const content = await callTool(token, name, args);
  return content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** 服务器时间 */
async function nowInfo(token) {
  const raw = await callToolJson(token, 'now-time-info', {});
  if (raw && raw.success && raw.data) return raw.data;
  return null;
}

/** 积分账户 */
async function myAccount(token) {
  const raw = await callToolJson(token, 'query-my-account', {});
  if (raw && raw.success && raw.data) return raw.data;
  return null;
}

/** 到店/得来速门店搜索 */
async function nearbyStores(token, { city, keyword, beType = 1 }) {
  const raw = await callToolJson(token, 'query-nearby-stores', {
    beType,
    searchType: 2,
    city: city || '',
    keyword: keyword || '',
  });
  if (raw && raw.success) return raw.data || [];
  return [];
}

/** 菜单（需要门店营业中） */
async function meals(token, storeCode) {
  const raw = await callToolJson(token, 'query-meals', {
    storeCode: String(storeCode),
    orderType: 1,
    beType: 1,
  });
  if (!raw || !raw.success) return null;
  const d = raw.data || {};
  const out = [];
  const detail = d.meals || {};
  for (const cat of d.categories || []) {
    for (const m of cat.meals || []) {
      const info = detail[m.code] || {};
      out.push({
        code: String(m.code),
        name: info.name || m.code,
        price: toFen(info.currentPrice),
        original: toFen(info.originalPrice || info.currentPrice),
        category: cat.name || '',
        tags: m.tags || [],
      });
    }
  }
  return out.filter((m) => m.price > 0);
}

/** 门店可用券（JSON：couponId/couponCode/products[].productCode） */
async function storeCoupons(token, storeCode) {
  const raw = await callToolJson(token, 'query-store-coupons', {
    storeCode: String(storeCode),
    orderType: 1,
    beType: 1,
  });
  if (!raw || !raw.success) return [];
  const list = raw.data || [];
  return list.map((c) => ({
    title: c.title || '未命名券',
    couponId: c.couponId,
    couponCode: c.couponCode,
    validTime: c.tradeDateTime || '',
    productCode: String((c.products && c.products[0] && c.products[0].productCode) || ''),
    productName: (c.products && c.products[0] && c.products[0].productName) || '',
    // 券面价：从标题里抠 "19.9元"/"9.9元"；免费券按 0 元商品处理时单独标记
    facePrice: parseFacePrice(c.title),
    free: /免费|^0[.]?\d*元/.test(c.title) && !/\d+(\.\d+)?元/.test(c.title),
  }));
}

/** 营养数据文本 → 结构化数组（list-nutrition-foods 的 data 字段或全文均可） */
function parseNutritionText(t) {
  const out = [];
  const re = /^\s*(\S+?),[^,]*,(\d+),(\d+),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),/;
  for (const line of String(t).split('\n')) {
    const m = line.match(re);
    if (m) {
      out.push({
        name: m[1],
        energyKj: +m[2],
        kcal: +m[3],
        protein: +m[4],
        fat: +m[5],
        carb: +m[6],
        sodium: +m[7],
      });
    }
  }
  return out;
}

/** 营养数据：[{name,kcal,protein,fat,carb,sodium}] */
async function nutrition(token) {
  const t = await text(token, 'list-nutrition-foods', {});
  return parseNutritionText(t);
}

/** 卡包（人类可读文本，正则提取今日到期等信号） */
async function myCoupons(token, pageIndex = 1, pageSize = 20) {
  const t = await text(token, 'query-my-coupons', { pageIndex, pageSize });
  const summary = (t.match(/共\s*(\d+)\s*张可用优惠券/) || [])[1];
  const expiringToday = [];
  const re = /##\s+(.+?)\n[\s\S]*?(?=## |\n###|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const block = m[0];
    if (block.includes('今日到期')) expiringToday.push(m[1].trim());
  }
  return {
    total: summary ? +summary : null,
    expiringToday,
    raw: t,
  };
}

/** 可领券列表 */
async function availableCoupons(token) {
  const t = await text(token, 'available-coupons', {});
  const unclaimed = (t.match(/状态：未领取/g) || []).length;
  const total = (t.match(/优惠券标题：/g) || []).length;
  const titles = [...t.matchAll(/优惠券标题：(.+?) \\/g)].map((x) => x[1].trim());
  return { total, unclaimed, titles };
}

/** 营销活动日历（文本） */
async function campaignCalendar(token, date) {
  const t = await text(token, 'campaign-calendar', date ? { specifiedDate: date } : {});
  const days = [];
  const re = /####\s+(\d{4}-\d{2}-\d{2})\s+([^\n]*)\n([\s\S]*?)(?=####\s+\d{4}|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const titles = [...m[3].matchAll(/\*\*活动标题\*\*：(.+)/g)].map((x) => x[1].trim());
    days.push({ date: m[1], tag: m[2].trim(), titles });
  }
  return days;
}

/** 单品详情（可在门店打烊时使用） */
async function mealDetail(token, storeCode, code) {
  const raw = await callToolJson(token, 'query-meal-detail', {
    storeCode: String(storeCode),
    orderType: 1,
    beType: 1,
    code: String(code),
  });
  if (raw && raw.success) return raw.data || null;
  return null;
}

/** 核价（需要门店营业中；单位分） */
async function calcPrice(token, storeCode, items) {
  const raw = await callToolJson(token, 'calculate-price', {
    storeCode: String(storeCode),
    orderType: 1,
    beType: 1,
    items,
  });
  if (raw && raw.success) return raw.data || null;
  return null;
}

function parseFacePrice(title) {
  const m = title.match(/(\d+(?:\.\d+)?)\s*元/);
  return m ? Math.round(parseFloat(m[1]) * 100) : null;
}

function toFen(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, ''));
  if (Number.isNaN(n)) return 0;
  // menu 的 currentPrice 是元；统一转分
  return Math.round(n * 100);
}

module.exports = {
  text, nowInfo, myAccount, nearbyStores, meals, storeCoupons,
  nutrition, myCoupons, availableCoupons, campaignCalendar,
  mealDetail, calcPrice, parseFacePrice, toFen, parseNutritionText,
};
