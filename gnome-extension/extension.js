// Phrontis · GNOME Shell 扩展 —— 骨架（尚未实现）
//
// 目标形态（对应原型里的形态 A）：顶栏常驻一个小入口，显示「今日 N 项 · 打卡 M/K」，
// 点开是一个弹出面板：待办可勾 / 打卡可点 / 番茄钟可有倒计时 / 打开应用。
//
// 全部数据来自应用的 D-Bus 接口（见 ../docs/interface.md）。本文件不读任何 vault 文件。
//
// 注意：
//   - GNOME 45 起扩展是 ESM 模块（本骨架按 GNOME 50 写）；shell-version 见 metadata.json。
//   - 「往系统菜单里加东西」用的是 GNOME 的内部 API，升级可能坏 —— 坏的点都标了 TODO。
//   - 真要投入实现前，先在真实会话里跑一遍热重载（Looking Glass / `gnome-extensions`）。

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const BUS_NAME = 'io.github.lousync.Phrontis';
const OBJ_PATH = '/io/github/lousync/Phrontis';
const IFACE = 'io.github.lousync.Phrontis.Core1';

const PhrontisButton = GObject.registerClass(
class PhrontisButton extends PanelMenu.Button {
  _init() {
    // TODO(实现)：第二参用 0.0；图标换成 Phrontis 自带的（扩展内 icons/ 目录）
    super._init(0.0, 'Phrontis');

    this.add_child(new St.Icon({
      icon_name: 'document-open-symbolic',
      style_class: 'system-status-icon',
    }));

    // TODO(实现)：顶栏读数「今日 N 项 · 打卡 M/K」，随 Changed 信号更新
    this._label = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    this.add_child(this._label);

    // TODO(实现)：内容区 —— 待办（勾选）/ 打卡（chips）/ 番茄钟 / 打开应用
    this.menu.addMenuItem(new PopupMenu.PopupMenuItem('尚未连接 Phrontis'));
  }
});

export default class PhrontisExtension extends Extension {
  enable() {
    this._button = new PhrontisButton();
    // TODO(实现)：位置与顺序 —— 放到右侧、时钟旁边（原型的默认形态）
    Main.panel.addToStatusArea('phrontis', this._button, 0, 'right');

    // TODO(实现)：
    //   1. Gio.bus_watch_name(BUS_NAME) 监听应用在不在
    //   2. Gio.DBusProxy 调 GetToday / ToggleTodo / CheckIn / PomodoroControl
    //   3. 订阅 Changed 信号 → 重新拉 GetToday → 更新顶栏读数与面板
    //   4. 应用没运行时靠 D-Bus 激活把它拉起来（.desktop 里 DBusActivatable=true）
    this._proxy = null;
    this._watchId = 0;
  }

  disable() {
    // TODO(实现)：解绑信号、断开 bus_watch、置空 proxy
    this._proxy = null;
    this._watchId = 0;
    this._button?.destroy();
    this._button = null;
  }
}
