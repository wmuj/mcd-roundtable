'use strict';
/**
 * 三军师圆桌 —— 全部台词由真实优化结果驱动（槽位填充，非 LLM）。
 * 麦算盘（精算师）× 麦白瘦（营养师）× 麦幸福（干饭人）
 * 同样的数据会得到同样的辩论（按日期选种子），可复现、可审计。
 */

function pick(list, seed) {
  return list[seed % list.length];
}

function yuan(fen) {
  return (fen / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * @param {object} r optimize() 结果
 * @param {object} ctx { budgetFen, storeName, mode, points, expiringCoupons, has1024 }
 */
function debate(r, ctx) {
  const seed = ctx.seed || 0;
  const lines = [];
  const dealCount = r.usedCoupons.length;
  const savingsTxt = `¥${yuan(r.savings)}`;
  const payTxt = `¥${yuan(r.totalPay)}`;
  const budgetTxt = `¥${yuan(ctx.budgetFen)}`;
  const comboNames = r.lines.map((l) => l.name + (l.qty > 1 ? `×${l.qty}` : ''));
  // 台词主角：优先用券主餐，其次最贵的一项
  const star = r.usedCoupons[0] || r.lines.reduce((a, b) => (a.unitPay >= b.unitPay ? a : b), r.lines[0]);
  const mainName = star ? star.name + (star.qty > 1 ? `×${star.qty}` : '') : '空气';
  const kcal = r.nutrition.kcal;
  const protein = r.nutrition.protein;

  // —— 麦算盘 开场：只谈钱 ——
  const a1 = dealCount > 0
    ? [
        `停。都别抢着说话。本单原价能吃到 ${yuan(r.totalValue)} 元的东西，实付 ${payTxt}，省下 ${savingsTxt}（${r.savingsPct}%）。${dealCount} 张券全部按券面价核过账，一分都不多花。`,
        `我先泼盆冷水：${payTxt} 是我能接受的底线吗？不。是天花板。好消息是这次用掉了 ${dealCount} 张券，省 ${savingsTxt}，账面很干净。`,
        `数字先摆桌上：预算 ${budgetTxt}，实付 ${payTxt}，省 ${savingsTxt}。别问我为什么这么精确，问就是职业习惯。`,
      ]
    : [
        `本单实付 ${payTxt}，预算 ${budgetTxt}。没用上券——你的券包我看过了，这次先记账，下次再算总账。`,
        `预算 ${budgetTxt}，实付 ${payTxt}。没有券可用的日子，我只做一件事：让每一分钱都变成看得见的汉堡。`,
      ];
  lines.push({ who: '麦算盘', tone: '精算师', text: pick(a1, seed) });

  // —— 麦白瘦 反驳：营养视角 ——
  let b1;
  if (kcal && protein) {
    const sodiumWatch = kcal > 900
      ? '另外钠大概率贴着警戒线了，今天其他两顿请自觉清淡。'
      : '钠水平尚可，属于一顿体面的正餐。';
    b1 = [
      `打住。${kcal} 大卡、蛋白质 ${protein}g——作为一顿正餐，蛋白达标，热量${kcal > 800 ? '偏高' : '可控'}。${sodiumWatch}`,
      `我来翻译一下麦算盘的"性价比"：${kcal} 大卡、${protein}g 蛋白质。这个组合能吃，但${kcal > 800 ? '热量在冲高，饮料建议换无糖' : '结构还行，记得配点蔬菜'}。`,
      `${protein}g 蛋白质，${kcal} 大卡——练后餐勉强及格${kcal > 800 ? '，但别加冰淇淋' : ''}。我不反对吃，我反对吃糊涂。`,
    ];
  } else {
    b1 = [
      `这套组合的营养数据我只能覆盖一部分——没匹配到的我不瞎编。原则先放这：主食能换全麦就换，饮料能无糖就无糖。`,
      `先说原则再说菜：一顿饭蛋白质至少 20g 起步，热量看着别超 900。这单具体多少，数据说了算，我不背锅。`,
    ];
  }
  lines.push({ who: '麦白瘦', tone: '营养师', text: pick(b1, seed + 1) });

  // —— 麦幸福 反击：干饭人宣言 ——
  const c1 = [
    `你们一个数钱、一个数卡路里，只有我在数快乐。${mainName}可是写进麦门圣经的配置，今晚就它了！`,
    `麦算盘你上次说"省钱"省到只点了个圆筒冰淇淋；麦白瘦你上周还夸薯条是碳水快乐之源。都别装了——${mainName}，冲！`,
    `人生苦短，麦门永恒。${mainName}在这张桌上，谁也别想把它换成水煮西兰花。`,
  ];
  lines.push({ who: '麦幸福', tone: '干饭人', text: pick(c1, seed + 2) });

  // —— 麦算盘 补充：凑单/预算余量 ——
  const remain = ctx.budgetFen - r.totalPay;
  if (remain >= 300) {
    const d1 = [
      `补充：预算还剩 ¥${yuan(remain)}。想加个甜品或派，够；想留给我说的"明天会更贵"基金，也够。`,
      `还剩 ¥${yuan(remain)} 余量。要我说，省下的钱才是这顿饭最好吃的部分。`,
    ];
    lines.push({ who: '麦算盘', tone: '精算师', text: pick(d1, seed + 3) });
  } else if (remain >= 0) {
    lines.push({ who: '麦算盘', tone: '精算师', text: `补充：预算用到只剩 ¥${yuan(remain)}，正好卡线，这个方案不能再膨胀了。` });
  }

  // —— 麦白瘦 补充：换购建议 ——
  if (kcal && kcal > 800) {
    lines.push({ who: '麦白瘦', tone: '营养师', text: pick([
      '最后一嘴：把含糖饮料换成无糖茶或零度可乐，这顿的负罪感直接打八折。',
      '补充一句：今晚就别再加冰淇淋了，明天可以，明天一定可以。',
    ], seed + 4) });
  } else if (ctx.expiringCoupons && ctx.expiringCoupons.length) {
    lines.push({ who: '麦白瘦', tone: '营养师', text: `友情提醒（我这管营养的都得提醒你了）：你的「${ctx.expiringCoupons[0]}」今天到期，过期作废算不算另一种不健康？` });
  }

  // —— 1024 彩蛋 ——
  if (ctx.has1024) {
    lines.push({ who: '麦幸福', tone: '干饭人', text: '等等——我看见「1024“码”力翻倍」券了！程序员节快乐，这单必须写进年度总结！' });
  }

  return lines;
}

/** 主持人决议词 */
function verdict(r, ctx) {
  const comboNames = r.lines.map((l) => l.name + (l.qty > 1 ? `×${l.qty}` : ''));
  const dealCount = r.usedCoupons.length;
  const kcal = r.nutrition.kcal;
  const parts = [];
  parts.push(`圆桌决议：${comboNames.join(' + ')}`);
  parts.push(`实付 ¥${yuan(r.totalPay)}（预算 ¥${yuan(ctx.budgetFen)}）${r.savings > 0 ? `，用券省下 ¥${yuan(r.savings)}` : ''}${dealCount ? `，动用券 ${dealCount} 张` : ''}${kcal ? `，约 ${kcal} 大卡` : ''}。`);
  parts.push(ctx.mode === 'light'
    ? '本轮目标：蛋白质优先。练完再吃，问心无愧。'
    : '本轮目标：预算内价值最大化。省下的每一分，都是下一顿的启动资金。');
  return parts.join(' ');
}

/** 三军师综合评分（数据驱动，非随机） */
function scores(r, ctx) {
  const budgetUse = ctx.budgetFen > 0 ? r.totalPay / ctx.budgetFen : 1;
  const valueScore = Math.max(60, Math.min(99, 60 + r.savingsPct * 1.2)); // 省得越多越高
  const balanceScore = Math.max(55, Math.min(96, 96 - Math.abs(budgetUse - 0.9) * 80)); // 预算用得越足越高
  const kcal = r.nutrition.kcal || 600;
  const healthScore = Math.max(50, Math.min(95, 95 - Math.max(0, kcal - 550) / 12));
  return {
    '麦算盘': Math.round(valueScore),
    '麦白瘦': Math.round(healthScore),
    '麦幸福': Math.round((valueScore + balanceScore) / 2 + 8 > 99 ? 99 : (valueScore + balanceScore) / 2 + 8),
  };
}

module.exports = { debate, verdict, scores, yuan };
