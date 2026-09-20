# Skill Doctor 设计

## 目标

为 Veyr 增加面向 Codex 的 Skill Doctor，参考 Claude Code `/skill-doctor` 的核心
价值：帮助用户发现高 context 成本、低使用频率和从未使用的 Skill，并提供可核查的
调用证据与成本边界。

Skill Doctor 不将显式 `$skill` 请求直接等同于 Skill 已注入或任务成功；也不使用相邻
LLM 请求的 token 差值冒充某个 Skill 的真实 token 消耗。

## 对标 Claude Code

Claude Code 官方 `/skill-doctor` 报告面向会话中非 bundled / enterprise Skill，展示
每个 Skill 的 context cost 和使用频率，标记从未调用的 Skill，并建议优先关闭高成本、
未使用项。Claude 的 OTel 路径还可按 `skill.name` 归因 input/output/cache token 与
成本。

Veyr 采用相同的诊断问题，但 Codex 的数据合同不同，因此每项指标必须声明证据等级。

## 数据模型

```text
Skill Catalog
  → Runtime Evidence
  → Usage Attribution
  → Skill Doctor Report
```

### Skill Catalog

扫描当前 Codex 可见的 Skill 根：项目 `.agents/skills`、用户 `~/.agents/skills`、
Codex `.codex/skills` 与已授权的额外根。每个 Skill 记录：

- 稳定名称、来源、绝对路径的本地 hash；
- `SKILL.md` 字节数、行数与 tokenizer 估算 token；
- frontmatter description 的 listing 成本与正文成本分离；
- 重名/阴影关系；
- 是否由当前扫描范围可见。

静态成本是“文件内容体积估算”，不等于当前 turn 的实际注入 token，也不等于账单成本。

### Runtime Evidence

Skill 使用证据按强度排序：

| 证据 | 结论 |
| --- | --- |
| 结构化 skill input / app-server 记录 | 明确客户端请求使用 Skill |
| Codex rollout 中的 Skill 读取 / 注入记录 | 已观察到读取或注入，具体语义保留来源 |
| 用户显式 `$skill` | 请求使用，不等于已注入 |
| `SKILL.md` 文件读取 | 只表示文件被读取 |
| 无事件 | 未观测，不等于未使用 |

报告展示调用次数、最近使用时间、证据等级和关联 turn；只有在明确读取/结构化请求证据
存在时，才将该 Skill 标为“已使用”。

### Usage Attribution

三类数值绝不混算：

| 指标 | 口径 | 状态 |
| --- | --- | --- |
| 静态 context 成本 | `SKILL.md` / listing 的 tokenizer 估算 | 可直接计算，标为估算 |
| 原生 turn/request usage | Codex rollout 或 app-server 的原始 usage | 可直接显示，但默认不归因到单个 Skill |
| Skill 边际 token 成本 | 固定输入、模型、环境、权限和 Skill hash 的启用/禁用重复实验 | 仅在受控 A/B 通过时显示 |

若当前 rollout 缺少可核验 usage，Skill Doctor 显示“该环境未提供原生 usage”，而不是
输出 0 或猜测消耗。若有 usage 但没有可验证的 Skill 注入边界，则显示 turn usage，
但标记“不可归因到单个 Skill”。

## 诊断规则

- **高静态成本且未观测使用**：仅对 catalog 中可见且当前采集窗口没有强使用证据的
  Skill 提示；文案为“考虑禁用或缩短”，不称为无用。
- **描述成本过高**：listing description 超过预算阈值时，提示精简 description。
- **重名阴影**：同名 Skill 来自多个根时，展示优先级与潜在误触发风险。
- **请求未证明注入**：有 `$skill` 请求但无更强证据时，提示检查 host 记录或运行
  受控任务；不判失败。
- **版本回归候选**：同一 Skill hash 变更后，使用频率、静态成本或受控实验边际成本
  变化时，生成对比；样本不足不下结论。

## 报告集成

不增加新的用户命令。Skill Doctor 是 `veyr report` 的固定模块，与任务摘要、工具、
MCP 处于同一份 HTML / JSON 报告中。

```text
veyr report
  → 任务摘要
  → 工具与 MCP
  → Skill Doctor
       - 高成本 / 未使用候选
       - Skill 清单、来源、hash、静态 context 成本
       - 调用证据、调用频率与最近使用
       - 原生 usage 可用性与归因边界
       - 版本变化与受控实验结果（如有）
```

总览报告首屏显示最关键的 Skill 摘要和高成本未使用候选，详细表作为同页的 Skill
Doctor 模块。受控 A/B 只在用户显式启动的后续实验工作流中产出数据，不增加日常命令。

## 隐私

- 默认扫描 `SKILL.md` 本地内容，仅将名称、来源、hash、字节数、token 估算和证据
  摘要写入 Veyr 数据库。
- 不默认持久化 prompt、代码、命令参数、完整 rollout 正文或完整 Skill 正文。
- 如需解析 rollout，只读取白名单字段，保留 source file hash / offset 作为证据定位；
  原文件仍留在 Codex 自己目录。
- 受控 A/B 必须由用户显式启动，并在隔离/无副作用任务中执行。

## 验证

- fixture：不同来源、重名、未使用、显式请求、读取、结构化 input、usage 缺失与
  usage 可用。
- 静态测试：tokenizer 估算稳定性、hash 变化、优先级、规则文案不越界。
- rollout parser：仅提取白名单元数据，验证不把 prompt / 代码正文写入 Veyr。
- 受控实验：固定仓库提交、输入、模型、权限、环境和 Skill hash；每条件至少重复三次，
  同时报质量与 token 变化。

## 当前阶段边界

首个实现先交付 catalog 静态成本、显式请求证据、未使用候选和 Codex rollout usage
可用性检查。实际读取/注入证据与 per-Skill 原生 token 归因只有在本机 rollout schema
验证后启用；受控 A/B 是后续显式实验命令，不自动运行。
