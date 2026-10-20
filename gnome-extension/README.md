# Phrontis · GNOME Shell 扩展

形态 **A**（顶栏常驻入口 + 弹出面板）与 **B**（快速设置磁贴）的实现。

- 顶栏读数：`今日 N 项 · 打卡 M/K`（N = 未完成待办）
- 弹出面板：待办可勾、打卡可点、「打开 Phrontis」
- 快速设置磁贴：同源读数，点一下唤起应用
- 所有数据走应用的 D-Bus `Core1`，**不读 vault 文件**

## 安装

```bash
./install.sh
```

**Wayland 下必须重新登录**（GNOME 不会热加载新装扩展）；X11 可以 `Alt+F2` → `r`。
登录后确认：

```bash
gnome-extensions info phrontis@lousync.github.io
```

## 面板交互

- 勾选待办 / 打卡后**面板保持打开**，可以连续点下一条（不再点一次重开一次）。
- 图标勾选时有放大回弹；顶栏读数与分组标题（`待办 · N 未完成` / `打卡 · M/K`）即时更新。
- 写盘失败会回滚图标状态并弹通知，不会留下「看着勾了、其实没写」的假象。

## 快捷键

`Ctrl+Alt+S`：显示 / 隐藏 Phrontis 日程小窗。

- 由 **Mutter** 直接处理（`Main.wm.addKeybinding` + 扩展自带 GSettings schema），**Wayland 下也有效**。
- 应用内 Electron 的 X11 全局键只在 XWayland 窗口有焦点时才收得到，仅在扩展未启用时作为兜底。
- 改键：`gsettings --schemadir ~/.local/share/gnome-shell/extensions/phrontis@lousync.github.io/schemas set org.gnome.shell.extensions.phrontis toggle-day-panel "['<Super><Alt>s']"`

## 开发

- 应用没装、只有 `npm run dev` 在跑时，扩展会自动回退到总线名
  `io.github.lousync.Phrontis.Dev`（先试正式名，失败再试 `.Dev`）。
- 改完 `extension.js` 后重新执行 `./install.sh`，再重载 Shell。
- 打包成可分发 zip：

```bash
gnome-extensions pack . --out-dir=dist
```

### ⚠ headless 测试的副作用（踩过一次）

用 `timeout` 强杀 `gnome-shell --headless` 时，GNOME 会把它记成一次**启动失败**，在
`/run/user/$UID/gnome-shell-disable-extensions` 留下标记；**下次登录会禁用所有用户扩展**
（表象：顶栏变回原生样式、所有定制全部消失，但扩展目录和设置都还在）。

测试完务必清掉：

```bash
rm -f /run/user/$UID/gnome-shell-disable-extensions
gsettings set org.gnome.shell disable-user-extensions false
```

改这个键后 Shell 会**实时重载**扩展，不需要再登出一次。

## 当前边界

- 番茄钟**只显示状态**，控制（开始/暂停/重置）等应用侧 `PomodoroControl` 落地后再接。
- 待办最多显示 8 条，其余用「还有 N 项…」提示（面板不承担完整日程表）。
- 应用未运行时顶栏显示 `Phrontis`，面板里可一键启动。
