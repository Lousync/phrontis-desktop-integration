# 对外接口规格（Core1）

> **状态：v1 已实现**（2026-10-20，应用 3.9.2 / 阶段 1 核心通路）。
> 已落地：`GetToday` / `ToggleTodo` / `CheckIn` / `OpenApp` / `Search` / `GetCapabilities` + `Changed`。
> 下一批：`PomodoroControl`（权威状态机在渲染层，需要下行命令通道）、`OpenApp(relPath)`。
>
> 这是 Phrontis 与应用外消费者（GNOME 扩展、脚本、命令行、日历导出）之间**唯一的契约**。
> 改动规则：**只做加法**。删方法 / 改签名 / 改语义 = 破坏性变更，必须抬接口版本（`Core1` → `Core2`）并保留旧接口一段时间。

## 1. 传输层

- **D-Bus（会话总线）** —— 应用侧暴露。
  - Bus name：`io.github.lousync.Phrontis`（dev 构建：`io.github.lousync.Phrontis.Dev`）
  - Object path：`/io/github/lousync/Phrontis`
  - Interface：`io.github.lousync.Phrontis.Core1`
  - 名称请求使用 **DO_NOT_QUEUE**：同名实例已存在时第二个直接失败，不排队（否则调用方会一直挂着）。
- **命令行镜像** —— `phrontis-cli`（同一份实现的第二个入口，走 D-Bus，不直接碰 vault）。
  - 刻意**不占用** `/usr/bin/phrontis`：那是 GUI 的链接，升级时替换会静默破坏既有使用习惯。
  - dev：`./scripts/phrontis-cli.sh`（默认连 `.Dev` 总线名）。
- **D-Bus 激活** —— `.desktop` 里 `DBusActivatable=true` + `/usr/share/dbus-1/services/io.github.lousync.Phrontis.service`；
  面板上的「打卡」在应用没开时能把应用拉起来。

## 2. 数据模型（D-Bus 签名）

```
Todo  = (s id, s text, b done, s due, i quadrant)        → (ssbsi)
Habit = (s id, s name, b doneToday, i streak, i target)  → (ssbii)
Pomo  = (i state, i leftSeconds, i totalSeconds)         → (iii)   // 0 idle / 1 running / 2 paused
Day   = (s date, a(Todo), a(Habit), Pomo)                → (sa(ssbsi)a(ssbii)(iii))
```

> `GetToday` 的 `todos` 口径（2026-10-20 拍板 A）：**今天到期 + 逾期未完成**；
> 不含「待安排」计划类、已完成、子任务。`due` 是日期串（`YYYY-MM-DD`），逾期由 `due < date` 推出。
> `totalSeconds` 目前由 `leftSeconds / (1 - progress)` 反推；阶段 2 改为渲染层直接上报精确值。

## 3. 方法

| 方法 | D-Bus 签名 | 说明 |
|---|---|---|
| `GetToday` | `() -> (Day)` | 今日全量（待办 + 打卡 + 番茄快照）。**面板打开时调一次**，之后靠 `Changed` 刷新。 |
| `ToggleTodo` | `(s id) -> (b)` | 勾选 / 取消勾选；`false` = 找不到该待办。 |
| `CheckIn` | `(s habitId, b value) -> (b)` | 打卡 / 取消打卡。**幂等**：已是目标状态也返回 `true`；含远程监督推送。`false` = 习惯不存在。 |
| `PomodoroControl` | `(s action) -> (Pomo)` | **下一批**。`action ∈ {start, pause, resume, reset}`。 |
| `OpenApp` | `(s target) -> (b)` | 唤起窗口。`target` = `''` / `today` / `pomodoro`；`relPath` **下一批**（现在返回 `false`）。 |
| `Search` | `(s query, i limit) -> (as)` | 只搜标题 / 正文 / 标签，返回 `relPath` 列表（最多 50）。 |
| `ToggleDayPanel` | `() -> (b)` | 显示 / 隐藏日程小窗。GNOME 扩展的原生快捷键走这里（XWayland 下 Electron 的全局键不可靠）。 |
| `GetCapabilities` | `() -> (as)` | `['today','todo','checkin','search','open','dayPanel']`。消费方据此探测，**不要拿版本号猜**。 |

## 4. 信号

| 信号 | 参数 | 说明 |
|---|---|---|
| `Changed` | `scope: s` | `today`（待办/打卡）或 `vault`（知识库）。消费方据此刷新，**不要轮询**。 |

**两条必须成立的行为**（否则面板会「点了没反应」）：

1. 面板调 `ToggleTodo` / `CheckIn` → 应用落盘 → 主进程 `broadcastDataChanged` → **广播 `Changed`**。反向（在应用里操作）同样要广播。
2. 信号必须**幂等**：消费方可能因重连收到不止一次。

## 5. 命令行镜像

```bash
phrontis-cli today [--json]
phrontis-cli todo toggle <id>
phrontis-cli todo done <id> | undo <id>          # 幂等：先读 GetToday，已是目标态则不发写
phrontis-cli checkin <习惯名|id> | uncheck <习惯名|id>
phrontis-cli search <query> [--limit 20] [--json]
phrontis-cli open [today|pomodoro]
phrontis-cli daypanel
phrontis-cli capabilities [--json]
```

约定：`--json` 输出稳定、可被脚本消费；无 `--json` 时输出人读摘要。<br>
**退出码**：0 成功 / 1 一般错误（含「应用未运行」）/ 2 找不到目标或用法错误。

## 6. 边界（明确不做）

- **不提供写正文的能力**（编辑器是唯一正文写入方）。
- **不提供任意文件读写**（要读文件用 `Search` + `OpenApp`，或走应用内既有能力）。
- **不让消费方直接访问 `.knowbase/` 或 vault 文件** —— 一律经接口。
- 不提供「订阅式推送大量数据」；`Changed` 只报「哪一类变了」，消费方自己来取。

## 7. 待定

- `GetToday` 是否需要分页 / 限制条数（今日待办理论上不多，但「逾期」可能很多）。
- 打卡的 `value: b` 是否够用（将来若有「打卡次数 / 时长」型习惯，需要 `a{sv}` 或数值）。
- A 顶栏读数里「今日 N 项」是算**未完成**还是**全部**（当前接口两者都能算，扩展侧定）。
