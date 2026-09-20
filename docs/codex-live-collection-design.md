# Codex 实时采集设计

## 目标

为 Veyr 增加用户级 Codex 实时采集路径：用户执行一次明确的 `veyr install`
确认后，Veyr 收集有限的生命周期证据，写入本地 spool 和 SQLite，并通过现有
报告生成器呈现结果。

该设计不代理模型请求、不读取模型私有推理、不自动信任 hook、不改变 managed
policy，也不默认保留 prompt、代码或完整工具输出。

## 兼容性合同

最低实时采集版本为 Codex CLI `0.124.0`。这是 OpenAI 在其公开 Release Notes
中首次将 hooks 标记为 stable 的稳定版本。低于该版本时，Veyr 不写入任何 Codex
配置，并建议升级或改用离线 JSONL 导入。

版本达到最低要求仍不足以安装。`veyr doctor` 必须确认：Codex 可执行、hooks 未
被禁用、用户级配置层可用、Veyr CLI build 可运行、数据目录可写。任何检查失败都
不写入配置。alpha/nightly 默认不安装；只有显式实验开关才可继续探测。

已通过真实回归的版本标记为 `verified`；仅版本和 probe 通过的版本标记为
`experimental`。更高版本不会自动变为 verified。

## 用户命令

```text
veyr install
veyr status
veyr report
veyr uninstall
```

`install` 在写入前显示精确 diff 并要求一次确认；`status` 显示运行状态、采集范围
和支持级别；`uninstall` 只删除 Veyr 自己拥有且 hash 匹配的条目。`report` 自动消费
本地 spool 并生成默认中文的 HTML/JSON 报告。`doctor` 保留为高级只读排障命令，
不出现在普通用户主流程。

## 配置与信任

安装只修改 `~/.codex/hooks.json` 与 `~/.codex/config.toml` 中由 Veyr 明确拥有的
条目。现有 hooks 和无关配置保留，原因是 Codex 会并行运行来自多个文件和 matcher
的 hooks。安装器禁止修改项目级配置、managed requirements 或既有 handler。

Codex 对非 managed hooks 按定义 hash 建立信任。为避免要求用户在安装后进入
Desktop 或 CLI 做第二次确认，Veyr 在安装命令的单次、明确确认后写入**仅属于 Veyr
新 handler** 的 trust hash。安装器必须先展示：将修改的文件、每个 handler、默认
采集字段、默认不采集字段与完整 diff。它不使用
`--dangerously-bypass-hook-trust`，不会改写其他 hook 的 trust state。

Veyr 将 manifest 保存在 `~/.veyr/` 中，记录：Codex 版本、目标配置、handler
位置、规范化 handler JSON、hash、安装时间和 Veyr 版本。卸载时先读回目标配置和
trust state 并比对 hash；不匹配表示用户或其他工具修改过配置，Veyr 终止并提供人工
移除指引。

该安装路径对 Codex CLI 与 Codex Desktop 使用相同的用户级配置。CLI 与 Desktop
必须分别通过真实采集验证后才标记为 `verified`；在验证前 Desktop 只标记为
`experimental`，不得宣称已支持。

## 采集链路

```text
Codex CLI / Desktop hook stdin
  → veyr shim
  → 原子 spool 文件
  → veyr report 的 collect 阶段
  → 规范化事件 / SQLite
  → HTML + JSON 报告
```

shim 只接受单个 JSON object，限制输入大小，写入带随机 suffix 的临时文件后原子
rename，不向 stdout 输出内容，不发网络请求，不调用模型。异步 hook 可乱序完成且
SessionEnd 同步执行，因此 collector 以原始时间和事件 ID 排序，而不以 spool 写入
顺序推断执行顺序。

## 事件范围与语义

首个真实采集切片注册：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、
`PostToolUse`、`Stop`、`SessionEnd`。

`PreToolUse` 记录已请求的调用；当存在 `tool_use_id` 时作为关联键。`PostToolUse`
表示观察到支持工具的后置事件，不能仅据事件名称认定成功。Bash 非零退出同样会触发
PostToolUse；只有 payload 中存在可解释的原生状态、exit code 或 MCP error 时，才
生成相应 outcome。字段缺失时记录 `unknown`。

`write_stdin` 是 Unified Exec 的运输/轮询动作，Codex 可以在其完成原命令时为原
`exec_command` 发出 PostToolUse。关联必须使用原始 `tool_use_id`，不能将轮询次数
当作新工具调用。Hosted WebSearch 等不经过本地 hook 路径的工具，报告显示为已知
覆盖缺口。

## 验证

单元测试覆盖版本比较、probe、hooks.json 合并与精确卸载、manifest hash、shim 大小
限制、spool 幂等消费和 payload 规范化。

fixture 覆盖 stable hook 基线、Bash 成功/非零退出、延迟完成、apply_patch、MCP、
未知 payload 和乱序写入。

真实 smoke test 使用隔离 `CODEX_HOME`：运行 doctor、预览并确认 install、验证仅有
Veyr handler/trust hash 写入、执行成功与失败命令、执行 report、核对证据与 outcome，
最后 uninstall 并逐字节读回原配置。真实结果通过前，支持状态保持 experimental。

Desktop 验证单独运行：在同一用户级配置下启动 Desktop，完成有工具调用的任务，检查
Veyr 是否收到实际事件；不能以 CLI 成功代替 Desktop 验证。
