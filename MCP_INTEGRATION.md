# MCP_INTEGRATION · 麦当劳 MCP 集成说明

本文档说明麦门圆桌实际使用的麦当劳 MCP Server、工具、调用流程与业务价值。

## 一、接入方式

- **Server**：麦当劳中国官方 MCP Server（[使用指南](https://github.com/M-China/mcd-mcp-server)）
- **地址**：`https://mcp.mcd.cn`
- **协议**：Streamable HTTP（JSON-RPC：`initialize` → `tools/list` → `tools/call`）
- **鉴权**：请求头 `Authorization: Bearer $MCD_MCP_TOKEN`（Token 通过环境变量注入，仓库中无任何真实凭证，见 [mcp-config.example.json](mcp-config.example.json)）
- **客户端实现**：`src/mcp.js` —— 零依赖极简 MCP 客户端，约 100 行，兼容纯 JSON 与 SSE 两种响应格式，含 401/429/超时的友好错误处理

## 二、实际调用的工具（9/35）

| # | 工具 | 用途 | 调用时机 |
|---|---|---|---|
| 1 | `now-time-info` | 服务器时间，作为"今日"基准 | `daily`、话术日期 |
| 2 | `query-nearby-stores` | 城市+关键词搜门店（`searchType=2`），取营业中门店的 `storeCode` | 圆桌开始前 |
| 3 | `query-meals` | 拉取门店菜单：分类 + 餐品编码 + 现价/原价 | 圆桌开始前 |
| 4 | `query-store-coupons` | 该门店可用的用户券：券ID/券码/**适用商品编码**/有效期 | 圆桌开始前 |
| 5 | `list-nutrition-foods` | 餐品营养（能量/蛋白质/脂肪/碳水/钠/钙） | 圆桌开始前 |
| 6 | `query-my-account` | 积分余额与本月将过期积分 | `daily`、军师话术 |
| 7 | `query-my-coupons` | 卡包全景（含"今日到期"标签） | `daily`、到期预警 |
| 8 | `available-coupons` | 麦麦省可领券列表 | `daily` |
| 9 | `campaign-calendar` | 当月营销活动日历 | `daily` |

另有 `auto-bind-coupons`（一键领券，`--claim` 显式触发）与 `calculate-price`（官方核价，用于人工复核组合价格）。

## 三、调用流程

```
initialize
  └─ 并行拉取：query-meals(storeCode) + query-store-coupons(storeCode) + list-nutrition-foods + query-my-account
       └─ 数据装配（纯代码，不经过 LLM）：
            ① 券 → 商品编码 匹配：券的 products[].productCode 关联菜单价，得到"用券省多少"
            ② 券面价解析：从券标题正则提取（如 "11.9元麦辣鸡腿堡" → 1190 分）
            ③ 营养名称模糊匹配：营养表名称 ↔ 菜品名（包含关系），无数据不虚构
            ④ 价格单位统一：菜单接口返回"元"，核价接口返回"分"——本项目全部按"分"计算
       └─ 确定性优化器（0/1 背包）：预算内最优组合
            └─ 军师圆桌（槽位填充台词，输入即优化结果）
```

## 四、踩过的坑（对社区有价值的实测结论）

1. **价格单位不一致**：`query-meals` 的 `currentPrice` 单位是元，`calculate-price` 返回单位是分。混用会把 ¥24.9 算成 ¥2490。本项目统一在装配层转"分"。
2. **`query-meals` 要求门店营业中**：非营业时间返回 `600057 门店可能已关闭或不在营业时间`。本项目提供 `--demo`（内置脱敏快照）与 24 小时门店建议（`--keyword 机场` 实测可搜到 `00:00-23:59` 门店）。
3. **`query-nearby-stores` 的 `searchType`**：`searchType=1` 查收藏餐厅，未登录收藏时返回"收藏餐厅列表为空"；必须 `searchType=2` 才按城市+关键词搜索。
4. **券与商品通过编码挂钩**：券的可用商品在 `products[].productCode`，与菜单编码同一体系；1024"码"力翻倍券对应的 `9900016523`（龙焰鸡腿堡两件套）等组合 SKU 在菜单中可直接查到原价。
5. **工具返回格式是"说明文本 + 原始 JSON"**：原始 JSON 附在文本尾部，本项目用括号配平解析器（`{"success"` 起点）提取，兼容 SSE 与纯 JSON。
6. **门店券因店而异**：机场 24 小时店实测券数为 0，王府井商圈门店有完整券包——优化器按门店维度取券，跨店数据不混用。

## 五、业务价值

- **对用户**：把"券多不会用、价格算不清"变成一场 30 秒的圆桌会议，预算硬约束下每单实打实省 20%~50%（实测：¥25 预算吃到 ¥36.5 原价组合）。
- **对 MCP 生态**：示范"**取数交给 MCP、算术交给代码、表达交给 Agent**"的分层架构——LLM 不做算术，只做人格化表达；优化结果确定性可复现，可审计。
- **对麦当劳**：优惠券的核销率取决于"用户知道哪张券今天不用就浪费了"。到期预警 + 一键领券 + 组合优化，直接服务券核销漏斗。
