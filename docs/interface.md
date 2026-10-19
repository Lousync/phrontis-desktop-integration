# 对外接口规格（草案）

> **状态：草案**，未实现。这是 Phrontis 与应用外消费者（GNOME 扩展、脚本、命令行、日历导出）之间**唯一的契约**。
> 改动规则：**只做加法**。删方法 / 改签名 / 改语义 = 破坏性变更，必须抬接口版本（`Core1` → `Core2`）并保留旧接口一段时间。

## 1. 传输层

- **D-Bus（会话总线）** —— 应用侧暴露。
  - Bus name：`io.github.lousync.Phrontis`
  - Object path：`/io/github/lousync/Phrontis`
  - Interface：`io.github.lousync.Phrontis.Core1`
- **命令行镜像** —— 同一份实现的第二个入口，供脚本 / rofi / Waybar 用。
- **D-Bus 激活** —— `.desktop` 里 `DBusActivatable=true` + `io.github.lousync.Phrontis.service`；这样面板上的「打卡」在应用没开时能把它拉起来。

## 2. 数据模型（返回结构）

```
Todo   = (id: s, text: s, done: b, due: s, quadrant: i)
Habit  = (id: s, name: s, doneToday: b, streak: i, target: i)
Pomo   = (state: i(0 idle/1 running/2 paused), leftSeconds: i, totalSeconds: i)
Day    = (date: s(YYYY-MM-DD), todos: a(Todo), habits: a(Habit), pomo: Pomo)
```

> 「象限 / 目标次数」等字段先留着，不代表第一版都用得上 —— 接口留位比事后加位便宜。

## 3. 方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `GetToday` | `() -> (Day)` | 今日全量（待办 + 打卡 + 番茄钟）。**面板打开时调一次。** |
| `ToggleTodo` | `(id: s) -> (ok: b)` | 勾选 / 取消勾选一条待办。 |
| `CheckIn` | `(habitId: s, value: b) -> (ok: b)` | 打卡 / 取消打卡。 |
| `PomodoroControl` | `(action: s) -> (Pomo)` | `action ∈ {start, pause, resume, reset}`；返回新状态。 |
| `OpenApp` | `(target: s) -> (ok: b)` | 唤起窗口；`target` 可为空或 `today` / `pomodoro` / 某个 `relPath`。 |
| `Search` | `(query: s, limit: i) -> (a(s))` | 只搜标题 / 路径，返回 `relPath` 列表（够给启动器用即可）。 |
| `GetCapabilities` | `() -> (a(s))` | 消费方用它做能力探测，**不要拿版本号猜**。 |

## 4. 信号

| 信号 | 参数 | 说明 |
|---|---|---|
| `Changed` | `scope: s` | 数据变了（`today` / `pomodoro` / `vault` …）。消费方据此刷新，**不要轮询**。 |

**两条必须成立的行为**（否则面板会「点了没反应」）：

1. 面板调 `CheckIn` → 应用落盘 → **广播 `Changed`**。反向（在应用里操作）同样要广播。
2. 信号必须**幂等**：消费方可能因重连收到不止一次。

## 5. 命令行镜像

```bash
phrontis today [--json]           # 今日摘要
phrontis todo list [--json]
phrontis todo done <id> | undo <id>
phrontis checkin <habit> | uncheck <habit>
phrontis pomodoro start [--minutes 25] | pause | resume | reset | status [--json]
phrontis search <query> [--limit 20]
phrontis open [<relPath>]
phrontis integration gnome install|enable|disable   # 可选：像 :PlugInstall 一样装配扩展
```

约定：`--json` 输出稳定、可被脚本消费（就是上面 Day 结构）；无 `--json` 时输出人读的一行摘要。<br>
**退出码**：0 成功 / 1 一般错误 / 2 用法错误 / 3 应用未运行且无法唤起。

## 6. 边界（明确不做）

- **不提供写正文的能力**（编辑器是唯一正文写入方）。
- **不提供任意文件读写**（要读文件用 `Search` + `OpenApp`，或走应用内既有能力）。
- **不让消费方直接访问 `.knowbase/` 或 vault 文件** —— 一律经接口。
- 不提供「订阅式推送大量数据」；`Changed` 只报「哪一类变了」，消费方自己来取。

## 7. 待定

- Bus name / UUID 的最终取值（`io.github.lousync.Phrontis` 只是暂定）。
- `GetToday` 是否需要分页 / 限制条数（今日待办理论上不多，但「某视角全量」可能很多）。
- 打卡的 `value: b` 是否够用（将来若有「打卡次数 / 时长」型习惯，需要 `a{sv}` 或数值）。
