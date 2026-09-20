# Codex 实时采集设计

## 目标

为 Veyr 增加项目级 Codex 实时采集路径：用户在受信任项目中显式安装并在
Codex `/hooks` 审阅后，Veyr 收集有限的生命周期证据，写入本地 spool 和
SQLite，并通过现有报告生成器呈现结果。

该设计不代理模型请求、不读取模型私有推理、不自动信任 hook、不改变 managed
policy，也不默认保留 prompt、代码或完整工具输出。

## 兼容性合同

最低实时采集版本为 Codex CLI `0.124.0`。这是 OpenAI 在其公开 Release Notes
中首次将 hooks 标记为 stable 的稳定版本。低于该版本时，Veyr 不写入任何 Codex
配置，并建议升级或改用离线 JSONL 导入。

版本达到最低要求仍不足以安装。`veyr doctor` 必须确认：Codex 可执行、hooks 未
被禁用、项目配置层可用、项目受信任、Veyr CLI build 可运行、数据目录可写。任何
检查失败都不写入配置。alpha/nightly 默认不安装；只有显式实验开关才可继续探测。

已通过真实回归的版本标记为 `verified`；仅版本和 probe 通过的版本标记为
`experimental`。更高版本不会自动变为 verified。

## 用户命令

```text
veyr doctor
veyr install
veyr report
veyr uninstall
```

命令默认作用于当前项目。`doctor` 只读；`install` 在写入前显示精确 diff；
`uninstall` 只删除 Veyr 自己拥有且 hash 匹配的条目。`report` 自动消费本地 spool
并生成默认中文的 HTML/JSON 报告。

## 配置与信任

安装只修改 `<project>/.codex/hooks.json`，且只追加独立 Veyr handler。现有 hooks
保留，原因是 Codex 会并行运行来自多个文件和 matcher 的 hooks。安装器禁止覆盖
用户级 hooks、`config.toml`、managed requirements 或既有 handler。

安装后 Veyr 显示 `/hooks` 审阅提示。Codex 对非 managed hooks 按定义 hash 建立
信任；Veyr 不使用 `--dangerously-bypass-hook-trust`，也不写入信任状态。

Veyr 将 manifest 保存在项目 `.veyr/` 中，记录：项目根、Codex 版本、目标配置、
handler ID、规范化 handler JSON、hash、安装时间和 Veyr 版本。卸载时先读回目标
配置并比对 hash；不匹配表示用户或其他工具修改过配置，Veyr 终止并提供人工移除
指引。

## 采集链路

```text
Codex hook stdin
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

真实 smoke test 使用隔离项目：运行 doctor、install、由用户在 `/hooks` 信任、执行
成功与失败命令、执行 report、核对证据与 outcome，最后 uninstall 并读回原配置。
真实结果通过前，支持状态保持 experimental。
