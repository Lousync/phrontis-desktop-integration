// Phrontis · GNOME Shell 扩展（形态 A + B）
//
// A：顶栏常驻入口「图标 + 今日 N 项 · 打卡 M/K」，点开是今日面板
// B：快速设置里的磁贴（读数同源；点一下唤起应用）
//
// 数据全部来自应用的 D-Bus `Core1`（见 ../docs/interface.md）。
// **本扩展不读任何 vault 文件**；勾待办 / 打卡都是调接口，由应用落盘并广播 Changed。
//
// 兼容：GNOME 45–50（ESM）。只用了 PanelMenu / PopupMenu / QuickSettings 的稳定面。
// 注意：GNOME 50 移除了 addExternalIndicator，磁贴直接挂到 quickSettings 菜单。

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

const OBJ = '/io/github/lousync/Phrontis';
const IFACE = 'io.github.lousync.Phrontis.Core1';
const BUS_PACKAGED = 'io.github.lousync.Phrontis';
const BUS_DEV = 'io.github.lousync.Phrontis.Dev';

// 方法返回体是「一个 struct 参数」⇒ 回复签名外面还有一层元组：((...))
const DAY_REPLY_TYPE = new GLib.VariantType('((sa(ssbsi)a(ssbii)(iii)))');
const BOOL_TYPE = new GLib.VariantType('(b)');

const REFRESH_SECONDS = 60;
const MAX_TODOS = 8;

function formatClock(seconds) {
    const s = Math.max(0, Math.trunc(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatDay(date) {
    const [y, m, d] = String(date ?? '').split('-').map(Number);
    if (!y || !m || !d) return '';
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(y, m - 1, d).getDay()];
    return `${m}月${d}日 ${week}`;
}

/** `(sa(ssbsi)a(ssbii)(iii))` → 普通对象（字段名与 interface.md 对齐） */
function unpackDay(variant) {
    const [date, todos, habits, pomo] = variant.deepUnpack()[0];
    return {
        date,
        todos: todos.map(([id, text, done, due, quadrant]) => ({id, text, done, due, quadrant})),
        habits: habits.map(([id, name, doneToday, streak, target]) => ({id, name, doneToday, streak, target})),
        pomo: {state: pomo[0], leftSeconds: pomo[1], totalSeconds: pomo[2]},
    };
}

export default class PhrontisExtension extends Extension {
    enable() {
        this._busName = null;
        this._day = null;
        this._requestSeq = 0;
        this._signalId = 0;
        this._nameIds = [];
        this._timer = 0;

        this._buildPanel();
        this._buildTile();
        this._subscribe();

        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });

        this._refresh();
    }

    disable() {
        this._requestSeq++;   // 让在途请求的结果失效

        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        if (this._signalId) {
            Gio.DBus.session.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        for (const id of this._nameIds)
            Gio.DBus.session.signal_unsubscribe(id);
        this._nameIds = [];

        this._button?.menu.removeAll();
        this._button?.destroy();
        this._button = null;
        this._label = null;

        this._tile?.destroy();
        this._tile = null;

        this._day = null;
        this._busName = null;
    }

    // ---------- UI ----------

    _buildPanel() {
        this._button = new PanelMenu.Button(0.0, 'Phrontis', false);

        const box = new St.BoxLayout({style_class: 'phrontis-panel-box'});
        box.add_child(new St.Icon({
            icon_name: 'x-office-document-symbolic',
            style_class: 'system-status-icon',
        }));
        this._label = new St.Label({
            text: 'Phrontis',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'phrontis-panel-label',
        });
        box.add_child(this._label);
        this._button.add_child(box);

        this._button.menu.box.add_style_class_name('phrontis-menu');
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) return;
            this._rebuildMenu();
            this._refresh();
        });

        // 贴快速设置（右侧）；index 0 = 右栏最左，紧挨快速设置
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');
        this._rebuildMenu();
    }

    _buildTile() {
        this._tile = new QuickSettings.QuickToggle({
            title: 'Phrontis',
            subtitle: '未运行',
            iconName: 'x-office-document-symbolic',
        });
        this._tile.connect('clicked', () => this._openApp());
        // statusArea.quickSettings 是「指示器」，磁贴要加在它的 menu 上（GNOME 50 已移除 addExternalIndicator）
        Main.panel.statusArea.quickSettings.menu.addItem(this._tile);
    }

    _sync() {
        const day = this._day;
        if (!day) {
            this._label.text = 'Phrontis';
            this._tile.subtitle = '未运行';
            this._rebuildMenu();
            return;
        }
        const pending = day.todos.filter(t => !t.done).length;
        const habitsDone = day.habits.filter(h => h.doneToday).length;
        this._label.text = `今日 ${pending} 项 · 打卡 ${habitsDone}/${day.habits.length}`;
        this._tile.subtitle = `${pending} 项待办 · 打卡 ${habitsDone}/${day.habits.length}`;
        this._rebuildMenu();
    }

    _rebuildMenu() {
        const menu = this._button?.menu;
        if (!menu) return;
        menu.removeAll();

        if (!this._day) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem('Phrontis 未运行', {reactive: false}));
            const start = new PopupMenu.PopupMenuItem('启动 Phrontis');
            start.connect('activate', () => this._openApp());
            menu.addMenuItem(start);
            return;
        }

        const header = new PopupMenu.PopupMenuItem(formatDay(this._day.date), {reactive: false});
        header.add_style_class_name('phrontis-meta');
        menu.addMenuItem(header);

        this._addSection(menu, '待办');
        const todos = this._day.todos.slice(0, MAX_TODOS);
        if (todos.length === 0) {
            this._addEmpty(menu, '今天没有待办');
        } else {
            for (const t of todos)
                menu.addMenuItem(this._todoItem(t));
            if (this._day.todos.length > todos.length)
                this._addEmpty(menu, `还有 ${this._day.todos.length - todos.length} 项…`);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._addSection(menu, '打卡');
        if (this._day.habits.length === 0) {
            this._addEmpty(menu, '还没有习惯');
        } else {
            for (const h of this._day.habits)
                menu.addMenuItem(this._habitItem(h));
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const pomo = this._day.pomo;
        const pomoText = pomo.state === 0
            ? '未开始'
            : `${pomo.state === 1 ? '进行中' : '已暂停'} ${formatClock(pomo.leftSeconds)}`;
        const pomoItem = new PopupMenu.PopupMenuItem(`番茄钟 · ${pomoText}`, {reactive: false});
        pomoItem.add_style_class_name('phrontis-meta');
        menu.addMenuItem(pomoItem);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const open = new PopupMenu.PopupMenuItem('打开 Phrontis');
        open.connect('activate', () => this._openApp());
        menu.addMenuItem(open);
    }

    _addSection(menu, text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        item.add_style_class_name('phrontis-section');
        menu.addMenuItem(item);
    }

    _addEmpty(menu, text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        item.add_style_class_name('phrontis-empty');
        menu.addMenuItem(item);
    }

    _todoItem(todo) {
        const item = new PopupMenu.PopupBaseMenuItem();
        item.add_child(new St.Icon({
            icon_name: todo.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
            style_class: 'popup-menu-icon',
        }));
        const label = new St.Label({
            text: todo.text,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'phrontis-ellipsis',
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        item.add_child(label);
        item.connect('activate', () => this._toggleTodo(todo.id));
        return item;
    }

    _habitItem(habit) {
        const item = new PopupMenu.PopupBaseMenuItem();
        item.add_child(new St.Icon({
            icon_name: habit.doneToday ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
            style_class: 'popup-menu-icon',
        }));
        const label = new St.Label({
            text: habit.name,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'phrontis-ellipsis',
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        item.add_child(label);
        if (habit.streak > 0) {
            item.add_child(new St.Label({
                text: `${habit.streak} 天`,
                style_class: 'phrontis-meta',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        item.connect('activate', () => this._checkIn(habit.id, !habit.doneToday));
        return item;
    }

    // ---------- D-Bus ----------

    _subscribe() {
        // 应用侧写盘后会广播 Changed（托盘 / D-Bus / 应用内操作都会走到）
        this._signalId = Gio.DBus.session.signal_subscribe(
            null, IFACE, 'Changed', OBJ, null, Gio.DBusSignalFlags.NONE,
            () => this._refresh());

        // 应用启动 / 退出：刷新读数（否则面板会一直显示「未运行」）
        for (const name of [BUS_PACKAGED, BUS_DEV]) {
            this._nameIds.push(Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
                '/org/freedesktop/DBus', name, Gio.DBusSignalFlags.NONE,
                () => this._refresh()));
        }
    }

    _call(busName, method, params, replyType, flags) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                busName, OBJ, IFACE, method, params, replyType, flags, -1, null,
                (conn, res) => {
                    try {
                        resolve(conn.call_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    async _refresh() {
        const seq = ++this._requestSeq;
        let busName = null;
        let day = null;

        for (const name of [BUS_PACKAGED, BUS_DEV]) {
            try {
                // NO_AUTO_START：只是读读数，不该在登录时把应用拉起来
                const v = await this._call(name, 'GetToday', null, DAY_REPLY_TYPE,
                    Gio.DBusCallFlags.NO_AUTO_START);
                busName = name;
                day = unpackDay(v);
                break;
            } catch {
                // 这个总线名没人在用，试下一个
            }
        }

        if (seq !== this._requestSeq)
            return;

        this._busName = busName;
        this._day = day;
        this._sync();
    }

    async _toggleTodo(id) {
        if (!this._busName) return;
        try {
            const v = await this._call(this._busName, 'ToggleTodo',
                new GLib.Variant('(s)', [id]), BOOL_TYPE, Gio.DBusCallFlags.NONE);
            if (!v.deepUnpack()[0])
                Main.notify('Phrontis', '这条待办已经不存在了');
            await this._refresh();
        } catch (e) {
            this._fail('勾选失败', e);
        }
    }

    async _checkIn(habitId, value) {
        if (!this._busName) return;
        try {
            const v = await this._call(this._busName, 'CheckIn',
                new GLib.Variant('(sb)', [habitId, value]), BOOL_TYPE, Gio.DBusCallFlags.NONE);
            if (!v.deepUnpack()[0])
                Main.notify('Phrontis', '这个习惯已经不存在了');
            await this._refresh();
        } catch (e) {
            this._fail('打卡失败', e);
        }
    }

    async _openApp() {
        const candidates = [...new Set([this._busName, BUS_PACKAGED, BUS_DEV].filter(Boolean))];
        for (const name of candidates) {
            try {
                // NONE：应用没开时允许 D-Bus 激活把它拉起来
                await this._call(name, 'OpenApp',
                    new GLib.Variant('(s)', ['']), BOOL_TYPE, Gio.DBusCallFlags.NONE);
                return;
            } catch {
                // 试下一个
            }
        }
        Main.notify('Phrontis', '找不到正在运行的应用，也没有可激活的 D-Bus 服务');
    }

    _fail(title, e) {
        console.warn(`[phrontis] ${title}:`, e);
        Main.notify('Phrontis', title);
    }
}
