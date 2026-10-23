'use strict';
/**
 * daily 命令：今日麦门情报 —— 积分过期预警 / 券到期预警 / 可领券 / 活动日历 / 1024 彩蛋。
 */
const api = require('./mcdapi');
const ui = require('./ui');
const { yuan } = require('./personas');

async function daily(token) {
  const out = [];
  out.push(ui.banner());
  out.push(ui.section('今日麦门情报'));

  const now = await api.nowInfo(token);
  const dateStr = now && now.formatted ? now.formatted : new Date().toLocaleString('zh-CN');
  out.push(ui.GREY(`  ${dateStr}`));
  out.push('');

  // 积分
  try {
    const acc = await api.myAccount(token);
    if (acc) {
      out.push(`  ${ui.GOLD('积分')} 可用 ${acc.availablePoint}${+acc.currentMouthExpirePoint > 0 ? ui.RED(` · 本月将过期 ${acc.currentMouthExpirePoint}（赶紧花掉！）`) : ui.GREY(' · 暂无过期风险')}`);
    }
  } catch (e) {
    out.push(ui.GREY(`  积分查询失败：${e.message}`));
  }

  // 卡包
  let has1024 = false;
  try {
    const c = await api.myCoupons(token);
    if (c.total !== null) {
      out.push(`  ${ui.GOLD('卡包')} 可用券 ${c.total} 张${c.expiringToday.length ? ui.RED(` · 今日到期 ${c.expiringToday.length} 张：${c.expiringToday.join('、')}`) : ui.GREY(' · 今日无到期')}`);
      has1024 = /1024/.test(c.raw);
    }
  } catch (e) {
    out.push(ui.GREY(`  卡包查询失败：${e.message}`));
  }

  // 可领券
  try {
    const av = await api.availableCoupons(token);
    if (av.total) {
      out.push(`  ${ui.GOLD('麦麦省')} 可领券 ${av.total} 张${av.unclaimed ? ui.GREEN(` · 其中 ${av.unclaimed} 张还没领（运行 mcd-roundtable --claim 一键领取）`) : ' · 均已领取'}`);
    }
  } catch (e) { /* 静默 */ }

  // 活动日历
  try {
    const days = await api.campaignCalendar(token);
    const today = (now && now.date) || new Date().toISOString().slice(0, 10);
    const active = days.filter((d) => d.date === today);
    const next = days.filter((d) => d.date > today).slice(0, 1);
    if (active.length) {
      out.push(`  ${ui.GOLD('活动')}`);
      for (const d of active) for (const t of d.titles) out.push(`    · [今天] ${t}`);
    }
    for (const d of next) for (const t of d.titles) out.push(`    · [${d.date}] ${t}`);
  } catch (e) { /* 静默 */ }

  if (has1024) {
    out.push('');
    out.push(ui.RED(ui.BOLD('  ⭐ 检测到「1024“码”力翻倍」券 —— 程序员节快乐，愿你的需求不变更。')));
  }

  out.push('');
  out.push(ui.GREY('  提示：mcd-roundtable --budget 25 开启圆桌辩论；--card out.svg 生成战报卡片'));
  return out.join('\n');
}

module.exports = { daily };
