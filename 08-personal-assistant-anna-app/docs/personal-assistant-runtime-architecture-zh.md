# Anna 主体个人助理模式运行架构

更新日期：2026-06-21

## 目标

本项目把 Anna 主体个人助理模式整理成一条稳定链路：

1. 用户在 Dashboard 的个人助理模式里发出请求。
2. Anna 主体通过 bundled Executa 调用 `personal_assistant` 工具。
3. 工具根据 `action` 分发到天气、健康、旅行、预订确认或强化学习模块。
4. 普通回复只读取已有强化学习记忆；只有用户明确要求“强化学习 / 自主学习 / 学习复盘 / 训练”等，才会启动本次学习循环。
5. 学习循环完成后把进度、复盘、经验和强化规则写入持久化记忆，后续回复读取这些规则来提升理解和表达。

## 主体 Skill 规范

本项目新增根目录 `SKILL.md` 作为 Anna 主体个人助理模式的行为契约，覆盖：

- 个人助理模式入口、前置问候、天气、健康、旅行、预订确认和学习记忆的工具调用顺序。
- 机票/酒店只走 Duffel 结构化供应商与官方网页人工接管；不混入 Amadeus、Travelport、Hotelbeds fallback。
- 用户表达“学习 / 训练 / 强化学习 / 自主学习 / 学习复盘”时，先执行 `learning_cycle`，再输出总结和后续应用规则。
- 所有大模型按能力路由：工具、视觉、音频和能力不匹配场景交给 `anna-auto`；纯文本任务给出实验路由建议，最后由 Anna 主机能力握手决定。
- 明确排除 `02-bilingual-focus-flow` 的 Focus 计时/双语教练行为；该归档项目不进入个人助理主体模式。

## 用户入口

Dashboard 中推荐入口：

- App：`Anna 个人助理模式`
- Executa tool id：`tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36`
- Tool：`personal_assistant`
- 常用动作：
  - `assist`：日常个人助理回复，会自动应用已存在的学习记忆。
  - `learning_cycle`：显式启动一次强化学习、自测、复盘和记忆写入。
  - `learning_status`：查看学习进度、累计书目记录、自测次数和最近经验。
  - `preflight`：进入个人助理模式时的问候、天气、健康连接提示。

用户可直接说：

```text
请进行本次强化学习并记住学习经验
```

这会触发 `assist` 内部的强化学习判断，并自动执行完整学习循环。

## 后端模块

```text
Dashboard / Anna Host
  -> bundled Executa: personal_assistant_plugin.cjs
    -> lib/service.js
      -> model-router.js        # 模型能力路由
      -> companion.js           # 回复结构与前置问候
      -> learning-loop.js       # 强化学习、自测、复盘、记忆
      -> weather.js             # 天气与空气质量
      -> health-store.js        # HealthKit consent gate
      -> travel.js              # 匿名旅行 handoff
      -> booking.js             # sandbox 预订确认
```

`personal_assistant_plugin.cjs` 支持 Anna loader 所需的 JSON-RPC 方法：

- `initialize`
- `initialized`
- `describe`
- `health`
- `invoke`
- `shutdown`

这能避免 Dashboard 或本地 Anna loader 在握手阶段出现 `describe returned no manifest` 或 `Plugin not found` 一类错误。

## 强化学习链路

一次学习循环包含：

1. 读取书目级课程表：心理学 5 本、逻辑学 5 本、用户回复能力 5 本。
2. 抽取原则标签：例如自主性、反操控、事实/推断/未知分离、清晰表达、可执行下一步。
3. 对 Anna 个人助理本身的当前回复做自测。
4. 根据自测结果生成修正规则。
5. 输出复盘。
6. 将进度、经验和规则写入学习记忆。
7. 后续普通回复通过 `learningLoop.recall()` 读取相关规则并应用。

默认记忆文件：

```text
~/.anna/personal-assistant-mode/learning-memory.json
```

可通过环境变量覆盖：

```bash
ANNA_LEARNING_MEMORY_PATH=/path/to/learning-memory.json
```

## 安全边界

- 不复制受版权保护书籍正文，只保存书目元数据、原则标签和自写复盘。
- 不保存用户原始私人对话，只保存学习进度、复盘摘要、经验和强化规则。
- 不声称微调或改变 Anna 主机底层模型权重；本项目强化的是个人助理模式的运行规则和记忆。
- 健康、法律、金融、付款、外站下单等高风险动作仍保留用户确认门。
- 旅行和预订能力不自动填写姓名、证件、联系方式、已保存旅客资料或付款信息。

## 运行检查

本地完整检查：

```bash
npm run check
npm test
npm run validate:anna
npm run smoke:ui
```

强化学习记忆链路检查：

```bash
npm run smoke:learning
```

生成中文报告：

```bash
npm run smoke:learning:report
```

报告会验证：

- 普通 `assist` 不会误触发学习。
- 显式强化学习指令会完成 15 本书目级学习记录。
- 自测、复盘和修正规则会写入记忆。
- 重新创建服务后仍能读取同一份记忆。
- 后续普通回复会应用已沉淀规则。

## Dashboard 部署状态说明

截至 2026-06-20，本项目的 `0.1.16` App 包已推送并切出版本，但 Anna 平台仍显示 App 处于 `pending_review`。在平台审核通过并允许 release 前，生产安装授权仍可能停留在旧版本。

因此试错时分两层判断：

1. 本地 Executa / Anna CLI / smoke 测试全部通过，说明本次项目成果本身可运行。
2. Dashboard 生产安装版本若仍显示旧版本，需要等待平台把 App 状态改为 `APPROVED` 或 `PUBLISHED` 后再执行 release 和安装更新。
3. 当前 `0.1.16` 已通过新 app-bundled Executa 解决旧 tool id 冻结在 `0.1.3` 的问题；`frozen_executas` 指向 `tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36` / Executa `0.1.6`，且本地 shim 的 `describe.name` 与 `initialize.serverInfo.name` 均匹配新 tool id。剩余 gate 是平台 `pending_review`。
