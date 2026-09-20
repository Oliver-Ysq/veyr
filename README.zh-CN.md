<h1 align="center">Veyr</h1>

<p align="center">
  <strong><em>看穿运行，验证结果。</em></strong>
</p>

<p align="center">
  面向编程 Agent 的证据优先可观测与诊断工具。
</p>

<p align="center">
  <sub>读作 /vɪər/，由 <code>verify</code> 截断而来 —— 看穿，而后校验。</sub>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

Veyr 是一个本地优先的编程 Agent 运行诊断工具。它将结构化事件整理为本地
SQLite 证据库，并生成方便人阅读的 HTML/JSON 报告。

首个 MVP 的目标宿主是 Codex 与 TraeX；但当前仓库交付的是可运行的
**离线 fixture 到报告的最小闭环**，尚不将实时宿主集成标记为已支持能力。

## 为什么需要 Veyr

Veyr 不尝试读取模型的私有推理，而是帮助用户基于可追溯证据回答四个实际问题：

- 哪些工具调用失败、重试、被拒绝，或缺少完整结果证据？
- 一个被观测任务的时间主要花在哪里？
- 哪些轮次出现异常大的可观测内容或原生 usage 增长？
- 哪些结论缺少支撑证据，或需要用户定向核验？

Veyr 有三条不可突破的原则：**观察到不等于成功；相关不等于因果；数据缺失时保持未知。**

## 当前状态

项目仍处于 pre-alpha 阶段。当前已支持的路径是：

```text
JSONL fixture → 规范化事件 → 本地 SQLite → HTML + JSON 报告
```

不需要模型 API Key。Veyr 不代理模型请求，也不会默认上传事件数据。

## 快速开始

需要 Node.js 22.5+ 和 pnpm 10+。

```bash
pnpm install
pnpm build
pnpm veyr demo
```

演示会在当前目录的 `.veyr/` 下写入本地数据库和报告。使用浏览器打开
`.veyr/reports/latest.html` 即可查看报告。

HTML 报告默认使用简体中文（`zh-CN`）。如需生成英文报告，可执行：

```bash
pnpm veyr report --lang en
```

也可以导入自己的 JSONL fixture：

```bash
pnpm veyr import fixtures/demo-events.jsonl
pnpm veyr report
```

## 实验性 Codex 实时采集

当 Codex CLI 版本不低于 `0.124.0` 时，Veyr 可以安装实验性的用户级 Codex
采集能力。`veyr install` 会展示精确变更预览并要求一次明确确认；确认后仅安装 Veyr
拥有的 hook 及其精确 trust hash，用户无需再进入 Desktop 或 CLI 完成第二次配置。

```bash
pnpm build
pnpm veyr install
```

正常使用 Codex 后，执行 `pnpm veyr report` 生成报告；使用 `pnpm veyr status`
查看采集状态与隐私范围，使用 `pnpm veyr uninstall` 只移除 Veyr 自己安装的 hook
和 trust 条目。

实时采集目前仍为实验性能力。默认只保存有大小限制的事件元数据和有限结果摘要；不会
保留 prompt、工具参数、完整工具输出或 transcript 路径。

报告会优先展示面向人的任务摘要、关联后的工具调用包络、下一步建议、观察到的 MCP
调用和 Skill 证据边界。调用包络由 Codex hook 时间戳测得，不会被表述为服务端执行
耗时。Skill 使用按证据等级展示；未观察到 Skill 证据不代表未使用 Skill。

## 仓库结构

```text
apps/cli           `veyr` 命令行工具
packages/core      事件契约、规范化与诊断规则
packages/report    静态 HTML 和 JSON 报告渲染
fixtures/          版本化离线事件样本
docs/              架构、隐私与支持范围文档
```

## 参与贡献

参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
