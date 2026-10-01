import { createBackend, isTauri, type Backend, type KV } from "./backend";
import { Sync } from "./sync";
import { DEFAULT_SETTINGS, type Priority, type Settings, type Task, type TaskList, type ViewKey, type WindowMode } from "./types";

// ---------------------------------------------------------------- иконки

const I = {
  chev: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  more: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  sync: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>`,
  gear: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  unlock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>`,
  power: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>`,
  back: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  check: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>`,
  grip: `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="8" cy="8" r="1"/><circle cx="4" cy="8" r="1"/><circle cx="8" cy="4" r="1"/></svg>`,
  ext: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  user: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  sun: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>`,
  all: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
};

// ---------------------------------------------------------------- состояние

let backend: Backend;
let kv: KV;
let sync: Sync;
let S: Settings = { ...DEFAULT_SETTINGS };

type Menu =
  | { kind: "view" }
  | { kind: "more" }
  | { kind: "task"; ref: string; x: number; y: number };

const ui = {
  menu: null as Menu | null,
  panel: null as null | "login" | "settings",
  expanded: new Set<string>(),
  editing: null as string | null,
  recentlyDone: new Set<string>(),
  newText: "",
  login: { email: "", busy: false, error: "" },
  toast: null as null | { text: string; action?: { label: string; fn: () => void } },
  autostart: false,
};

let toastTimer: number | undefined;
const app = document.getElementById("app")!;

// ---------------------------------------------------------------- утилиты

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function dueInfo(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff < 0) {
    const text = diff === -1 ? "Вчера" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return { text, cls: "overdue" };
  }
  if (diff === 0) return { text: "Сегодня", cls: "today" };
  if (diff === 1) return { text: "Завтра", cls: "" };
  if (diff < 7) {
    const wd = d.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
    return { text: wd.charAt(0).toUpperCase() + wd.slice(1), cls: "" };
  }
  const y = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : "";
  return { text: `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`, cls: "" };
}

/** Срок «на день»: 18:00 по местному времени, как делают задачи в Organism */
const dueOn = (d: Date) => {
  const x = new Date(d);
  x.setHours(18, 0, 0, 0);
  return x.toISOString();
};

const PRIO_W: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

function sortTasks(rows: Task[]) {
  return rows.sort((a, b) => {
    const da = a.due_at ? Date.parse(a.due_at) : Infinity;
    const db = b.due_at ? Date.parse(b.due_at) : Infinity;
    if (da !== db) return da - db;
    const pw = (PRIO_W[b.priority] ?? 0) - (PRIO_W[a.priority] ?? 0);
    if (pw) return pw;
    return (a.id < 0 ? Infinity : a.id) - (b.id < 0 ? Infinity : b.id);
  });
}

function visibleTasks(): Task[] {
  const meId = sync.me?.id;
  const endToday = addDays(startOfDay(new Date()), 1).getTime();
  const isMine = (t: Task) => meId != null && (t.assignee_id === meId || t.assignee2_id === meId);
  const rows = sync.tasks.filter((t) => t.status === "open" || ui.recentlyDone.has(t.short_id));
  const v = S.view;
  let out: Task[];
  if (v === "mine") out = rows.filter(isMine);
  else if (v === "today") out = rows.filter((t) => isMine(t) && t.due_at != null && Date.parse(t.due_at) < endToday);
  else if (v === "all") out = rows;
  else {
    const id = Number(v.slice(5));
    out = rows.filter((t) => t.list_id === id);
  }
  return sortTasks(out);
}

function viewTitle(): string {
  const name = sync.me?.name?.split(" ")[0] ?? "";
  if (S.view === "mine") return name ? `Задачи ${name}` : "Мои задачи";
  if (S.view === "today") return "Сегодня";
  if (S.view === "all") return "Все задачи";
  const l = sync.lists.find((x) => `list:${x.id}` === S.view);
  return l ? `${l.emoji ?? ""} ${l.name}`.trim() : "Список";
}

function listById(id: number | null): TaskList | undefined {
  return sync.lists.find((l) => l.id === id);
}

// ---------------------------------------------------------------- рендер

function render() {
  // сохраняем фокус и курсор, чтобы фоновая синхронизация не сбивала ввод
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active?.id;
  const selStart = active?.selectionStart ?? null;
  const selEnd = active?.selectionEnd ?? null;

  document.documentElement.dataset.theme = S.theme;
  document.documentElement.style.setProperty("--alpha", String(S.opacity));
  document.documentElement.style.setProperty("--scale", String(S.fontScale));

  const main = ui.panel
    ? ""
    : `${renderHead()}
      <div class="new">${I.plus}<input id="new-input" placeholder="Новая задача" value="${esc(ui.newText)}" autocomplete="off" spellcheck="false"></div>
      <div class="body" id="list">${renderList()}</div>
      ${renderFoot()}`;
  app.innerHTML = `
    <div class="widget ${S.locked ? "locked" : ""}">
      ${main}
      ${renderResize()}
      ${ui.menu ? renderMenu(ui.menu) : ""}
      ${ui.panel === "settings" ? renderSettings() : ""}
      ${ui.panel === "login" ? renderLogin() : ""}
      ${ui.toast ? `<div class="toast"><span>${esc(ui.toast.text)}</span>${ui.toast.action ? `<button data-act="toast">${esc(ui.toast.action.label)}</button>` : ""}</div>` : ""}
    </div>`;

  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (selStart !== null && "setSelectionRange" in el) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* не все поля поддерживают выделение */
        }
      }
    }
  }
}

function renderHead() {
  return `
    <div class="head ${S.locked ? "" : "draggable"}" data-drag>
      <button class="title-btn" data-act="view-menu"><span>${esc(viewTitle())}</span>${I.chev}</button>
      ${S.locked ? `<span class="lock-badge" title="Положение закреплено">${I.lock}</span>` : ""}
      <div class="spacer" data-drag></div>
      <button class="icon-btn" data-act="more" title="Меню">${I.more}</button>
    </div>`;
}

function renderList(): string {
  const rows = visibleTasks();
  if (!sync.me && !sync.tasks.length) {
    return `<div class="empty">${sync.state === "offline" ? "Нет сети. Задачи появятся после первой синхронизации." : "Загружаю задачи…"}</div>`;
  }
  if (!rows.length) return `<div class="empty">Задач нет</div>`;

  if (S.view.startsWith("list:")) return rows.map(renderTask).join("");

  // группировка по спискам, как разделы в TickTick
  const groups = new Map<string, Task[]>();
  for (const t of rows) {
    const key = t.list_id == null ? "none" : String(t.list_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const order = [...sync.lists.map((l) => String(l.id)), "none"].filter((k) => groups.has(k));
  return order
    .map((key) => {
      const l = key === "none" ? undefined : listById(Number(key));
      const name = l ? `${esc(l.name)} ${l.emoji ? esc(l.emoji) : ""}` : "Без списка";
      const collapsed = !!S.collapsed[key];
      const items = groups.get(key)!;
      return `
        <div class="group-head ${collapsed ? "collapsed" : ""}" data-act="group" data-key="${key}">
          <span class="chev">${I.chev}</span><span>${name}</span><span class="count">${items.filter((t) => t.status === "open").length}</span>
        </div>
        ${collapsed ? "" : items.map(renderTask).join("")}`;
    })
    .join("");
}

function renderTask(t: Task) {
  const done = t.status !== "open";
  const due = dueInfo(t.due_at);
  const open = ui.expanded.has(t.short_id);
  const editing = ui.editing === t.short_id;
  const desc = (t.description_md ?? "").trim();
  return `
    <div class="task ${done ? "done" : ""} ${t._pending ? "pending" : ""} ${open ? "open-desc" : ""}" data-ref="${esc(t.short_id)}">
      <button class="cb p-${esc(t.priority)}" data-act="toggle" title="${done ? "Вернуть" : "Выполнить"}">${I.check}</button>
      <div class="tmain">
        ${
          editing
            ? `<input class="ttl-edit" id="edit-input" value="${esc(t.title)}" spellcheck="false">`
            : `<div class="ttl" data-act="expand" title="${esc(t.title)}">${esc(t.title)}</div>`
        }
        ${open && desc && !editing ? `<div class="desc">${esc(desc)}</div>` : ""}
      </div>
      ${t._pending ? `<span class="dot-pending" title="Ждёт отправки"></span>` : ""}
      ${due ? `<span class="due ${due.cls}">${due.text}</span>` : ""}
    </div>`;
}

function renderFoot() {
  const n = sync.outbox.length;
  const q = n ? ` · в очереди: ${n}` : "";
  let led = sync.state as string;
  let text: string;
  switch (sync.state) {
    case "syncing":
      text = "Синхронизация…";
      break;
    case "offline":
      text = `Офлайн${q}`;
      break;
    case "auth":
      text = "Нужно войти заново";
      break;
    case "error":
      text = `Ошибка сервера${q}`;
      break;
    default: {
      led = n ? "offline" : "idle";
      const at = sync.cache.syncedAt ? new Date(sync.cache.syncedAt) : null;
      text = at ? `Обновлено ${at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}${q}` : q.slice(3);
    }
  }
  return `<div class="foot" title="${esc(sync.lastError ?? "")}"><span class="led ${led}"></span><span>${esc(text)}</span></div>`;
}

function renderResize() {
  const dirs: [string, string][] = [
    ["n", "North"], ["s", "South"], ["e", "East"], ["w", "West"],
    ["ne", "NorthEast"], ["nw", "NorthWest"], ["sw", "SouthWest"], ["se", "SouthEast"],
  ];
  return dirs.map(([c, d]) => `<div class="rz rz-${c}" data-resize="${d}">${c === "se" ? I.grip : ""}</div>`).join("");
}

function renderMenu(m: Menu) {
  if (m.kind === "view") {
    const counts = (v: ViewKey) => {
      const keep = S.view;
      S.view = v;
      const n = visibleTasks().filter((t) => t.status === "open").length;
      S.view = keep;
      return n;
    };
    const item = (v: ViewKey, icon: string, label: string) =>
      `<button class="mi ${S.view === v ? "active" : ""}" data-act="set-view" data-view="${v}"><span class="ico">${icon}</span>${label}<span class="cnt">${counts(v) || ""}</span></button>`;
    return `<div class="menu" style="left:10px;top:44px">
      ${item("mine", I.user, "Мои задачи")}
      ${item("today", I.sun, "Мои на сегодня")}
      ${item("all", I.all, "Все задачи")}
      <div class="msep"></div>
      ${sync.lists.map((l) => item(`list:${l.id}`, `<span>${esc(l.emoji ?? "•")}</span>`, esc(l.name))).join("")}
    </div>`;
  }
  if (m.kind === "more") {
    return `<div class="menu" style="right:10px;top:44px">
      <button class="mi" data-act="sync"><span class="ico">${I.sync}</span>Синхронизировать</button>
      <button class="mi" data-act="settings"><span class="ico">${I.gear}</span>Настройки</button>
      <button class="mi" data-act="lock"><span class="ico">${S.locked ? I.unlock : I.lock}</span>${S.locked ? "Разблокировать" : "Заблокировать"}</button>
      <button class="mi" data-act="open-web"><span class="ico">${I.ext}</span>Открыть Organism</button>
      <div class="msep"></div>
      <button class="mi" data-act="hide"><span class="ico">${I.power}</span>Закрыть</button>
    </div>`;
  }
  const t = sync.tasks.find((x) => x.short_id === m.ref);
  if (!t) return "";
  const w = app.clientWidth;
  const h = app.clientHeight;
  const left = Math.max(8, Math.min(m.x, w - 220));
  const top = Math.max(8, Math.min(m.y, h - 330));
  const pr = (p: Priority, label: string) =>
    `<button class="chip ${t.priority === p ? "on" : ""}" data-act="prio" data-p="${p}">${label}</button>`;
  return `<div class="menu" style="left:${left}px;top:${top}px;width:210px">
    ${t._pending ? "" : `<button class="mi" data-act="open-task"><span class="ico">${I.ext}</span>Открыть в Organism</button>`}
    <button class="mi" data-act="rename"><span class="ico">${I.edit}</span>Переименовать</button>
    <div class="mlabel">Приоритет</div>
    <div class="mrow">${pr("high", "!!!")}${pr("medium", "!!")}${pr("low", "!")}${pr("none", "—")}</div>
    <div class="mlabel">Срок</div>
    <div class="mrow">
      <button class="chip" data-act="due" data-d="0">Сегодня</button>
      <button class="chip" data-act="due" data-d="1">Завтра</button>
      <button class="chip" data-act="due" data-d="7">Неделя</button>
      <button class="chip" data-act="due" data-d="x">${I.x}</button>
    </div>
    <div class="mlabel">Список</div>
    ${sync.lists
      .map(
        (l) =>
          `<button class="mi ${t.list_id === l.id ? "active" : ""}" data-act="move" data-list="${l.id}"><span class="ico">${esc(l.emoji ?? "•")}</span>${esc(l.name)}</button>`,
      )
      .join("")}
    <div class="msep"></div>
    <button class="mi danger" data-act="wontdo"><span class="ico">${I.x}</span>Не буду делать</button>
  </div>`;
}

function renderSettings() {
  const seg = (name: string, cur: string, opts: [string, string][]) =>
    `<div class="seg">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-act="set" data-k="${name}" data-v="${v}">${l}</button>`).join("")}</div>`;
  return `<div class="panel">
    <div class="head ${S.locked ? "" : "draggable"}" data-drag>
      <button class="icon-btn" data-act="close-panel" title="Назад">${I.back}</button>
      <b style="font-size:1.05em">Настройки</b>
      <div class="spacer" data-drag></div>
    </div>
    <div class="body">
      <div class="field"><span class="lbl">Положение окна</span>
        ${seg("windowMode", S.windowMode, [["normal", "Обычное"], ["top", "Поверх окон"], ["bottom", "На столе"]])}
        <div class="hint">«На столе» держит виджет под остальными окнами, как стикер на рабочем столе.</div>
      </div>
      <div class="field"><span class="lbl">Тема</span>${seg("theme", S.theme, [["dark", "Тёмная"], ["light", "Светлая"]])}</div>
      <div class="field"><label>Непрозрачность фона · ${Math.round(S.opacity * 100)}%</label>
        <input type="range" min="40" max="100" value="${Math.round(S.opacity * 100)}" data-range="opacity"></div>
      <div class="field"><label>Размер текста · ${Math.round(S.fontScale * 100)}%</label>
        <input type="range" min="85" max="130" step="5" value="${Math.round(S.fontScale * 100)}" data-range="fontScale"></div>
      <div class="field"><label>Список для новых задач</label>
        <select class="input" data-select="defaultListId">
          <option value="">Без списка</option>
          ${sync.lists.map((l) => `<option value="${l.id}" ${S.defaultListId === l.id ? "selected" : ""}>${esc(l.emoji ?? "")} ${esc(l.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label class="switch">Запускать при входе в систему<input type="checkbox" data-check="autostart" ${ui.autostart ? "checked" : ""}></label></div>
      <div class="field"><label class="switch">Закрепить положение и размер<input type="checkbox" data-check="locked" ${S.locked ? "checked" : ""}></label></div>
      <div class="field"><label class="switch">Показывать на всех рабочих столах<input type="checkbox" data-check="allWorkspaces" ${S.allWorkspaces ? "checked" : ""}></label></div>
      <div class="msep" style="margin:16px 0"></div>
      <div class="acc"><b>${esc(sync.me?.name ?? "")}</b><span>${esc(sync.me?.email ?? "")}</span></div>
      <button class="btn danger" data-act="logout">Выйти из аккаунта</button>
      <details style="margin-top:16px">
        <summary>Сервер</summary>
        <div class="field"><label>Organism (вход)</label><input class="input" id="set-auth" value="${esc(S.authUrl)}" spellcheck="false"></div>
        <div class="field"><label>Модуль задач</label><input class="input" id="set-project" value="${esc(S.projectUrl)}" spellcheck="false"></div>
        <button class="btn ghost" data-act="save-endpoints">Сохранить адреса</button>
      </details>
    </div>
  </div>`;
}

function renderLogin() {
  return `<div class="panel">
    <div class="head ${S.locked ? "" : "draggable"}" data-drag><div class="spacer" data-drag></div>
      <button class="icon-btn" data-act="hide" title="Скрыть">${I.x}</button></div>
    <div class="body">
      <div class="brand"><div class="k">bioaura</div><div class="n">organism</div><div class="s">Вход в виджет задач</div></div>
      <form id="login-form">
        <div class="field"><label>Email</label><input class="input" id="login-email" type="email" autocomplete="username" value="${esc(ui.login.email)}" required></div>
        <div class="field"><label>Пароль</label><input class="input" id="login-pass" type="password" autocomplete="current-password" required></div>
        ${ui.login.error ? `<div class="err">${esc(ui.login.error)}</div>` : ""}
        <button class="btn" type="submit" ${ui.login.busy ? "disabled" : ""}>${ui.login.busy ? "Входим…" : "Войти"}</button>
        <div class="hint" style="text-align:center;margin-top:12px">Те же email и пароль, что в Organism. Вход нужен один раз.</div>
      </form>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- действия

async function saveSettings() {
  await kv.set("settings", S);
}

function showToast(text: string, action?: { label: string; fn: () => void }, ms = 4000) {
  ui.toast = { text, action };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast = null;
    render();
  }, ms);
  render();
}

async function applyWindow() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const mode: WindowMode = S.windowMode;
  await w.setAlwaysOnTop(mode === "top").catch(() => {});
  await w.setAlwaysOnBottom(mode === "bottom").catch(() => {});
  await w.setResizable(!S.locked).catch(() => {});
  await w.setVisibleOnAllWorkspaces(S.allWorkspaces).catch(() => {});
}

async function openUrl(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch(() => {});
  } else {
    window.open(url, "_blank");
  }
}

function createFromInput() {
  const title = ui.newText.trim();
  if (!title) return;
  const meId = sync.me?.id ?? null;
  const listId = S.view.startsWith("list:") ? Number(S.view.slice(5)) : S.defaultListId;
  const body: Partial<Task> = {
    title,
    list_id: listId ?? null,
    priority: "none",
    assignee_id: meId,
    due_at: S.view === "today" ? dueOn(new Date()) : null,
  };
  sync.create(body);
  ui.newText = "";
  render();
}

function toggleTask(ref: string) {
  const t = sync.tasks.find((x) => x.short_id === ref);
  if (!t) return;
  if (t.status === "open") {
    sync.setStatus(ref, "done");
    ui.recentlyDone.add(ref);
    window.setTimeout(() => {
      ui.recentlyDone.delete(ref);
      render();
    }, 1400);
    showToast("Задача выполнена", {
      label: "Отменить",
      fn: () => {
        sync.setStatus(ref, "open");
        ui.recentlyDone.delete(ref);
      },
    });
  } else {
    sync.setStatus(ref, "open");
    ui.recentlyDone.delete(ref);
  }
}

function commitEdit() {
  const ref = ui.editing;
  if (!ref) return;
  const input = document.getElementById("edit-input") as HTMLInputElement | null;
  const value = input?.value.trim();
  ui.editing = null;
  const t = sync.tasks.find((x) => x.short_id === ref);
  if (t && value && value !== t.title) sync.patch(ref, { title: value });
  render();
}

async function doLogin(email: string, password: string) {
  ui.login = { email, busy: true, error: "" };
  render();
  const r = await backend.login(email, password);
  if (r.status >= 200 && r.status < 300) {
    const me = await backend.api<{ id: number; email: string; name: string }>("GET", "/api/auth/me");
    if (me.status === 200) {
      await sync.adoptUser({ id: me.data.id, email: me.data.email, name: me.data.name });
      ui.login = { email, busy: false, error: "" };
      ui.panel = null;
      render();
      void sync.sync();
      return;
    }
    ui.login = { email, busy: false, error: me.status === 0 ? "Нет связи с модулем задач" : "Вход прошёл, но модуль задач недоступен для этого аккаунта" };
  } else if (r.status === 0) {
    ui.login = { email, busy: false, error: "Нет связи с сервером. Проверь интернет." };
  } else {
    const d = r.data as { detail?: unknown } | string | null;
    const detail = d && typeof d === "object" && typeof d.detail === "string" ? d.detail : "";
    ui.login = { email, busy: false, error: detail || "Неверный email или пароль" };
  }
  render();
}

async function hideWindow() {
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
}

// ---------------------------------------------------------------- события

app.addEventListener("mousedown", async (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  const rz = target.closest<HTMLElement>("[data-resize]");
  if (rz && !S.locked && isTauri) {
    e.preventDefault();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging(rz.dataset.resize as never);
    return;
  }
  const drag = target.closest("[data-drag]");
  if (drag && !target.closest("button,input") && !S.locked && isTauri) {
    e.preventDefault();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  }
});

app.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act]");
  const inMenu = target.closest(".menu");
  const act = el?.dataset.act;

  // клик мимо меню закрывает его
  if (ui.menu && !inMenu && act !== "view-menu" && act !== "more") {
    ui.menu = null;
    if (!act) return render();
  }
  if (!el || !act) return;
  const ref = el.closest<HTMLElement>("[data-ref]")?.dataset.ref ?? (ui.menu?.kind === "task" ? ui.menu.ref : "");

  switch (act) {
    case "view-menu":
      ui.menu = ui.menu?.kind === "view" ? null : { kind: "view" };
      break;
    case "more":
      ui.menu = ui.menu?.kind === "more" ? null : { kind: "more" };
      break;
    case "set-view":
      S.view = el.dataset.view as ViewKey;
      ui.menu = null;
      void saveSettings();
      break;
    case "group": {
      const k = el.dataset.key!;
      S.collapsed[k] = !S.collapsed[k];
      void saveSettings();
      break;
    }
    case "toggle":
      toggleTask(ref);
      break;
    case "expand": {
      // без полной перерисовки, чтобы не сбивать двойной клик (переименование)
      const row = el.closest<HTMLElement>(".task");
      const t = sync.tasks.find((x) => x.short_id === ref);
      const desc = (t?.description_md ?? "").trim();
      if (!row) return;
      if (ui.expanded.has(ref)) {
        ui.expanded.delete(ref);
        row.classList.remove("open-desc");
        row.querySelector(".desc")?.remove();
      } else {
        ui.expanded.add(ref);
        row.classList.add("open-desc");
        if (desc) {
          const div = document.createElement("div");
          div.className = "desc";
          div.textContent = desc;
          row.querySelector(".tmain")?.appendChild(div);
        }
      }
      return;
    }
    case "sync":
      ui.menu = null;
      void sync.sync();
      break;
    case "settings":
      ui.menu = null;
      ui.panel = "settings";
      if (isTauri) {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        ui.autostart = await isEnabled().catch(() => false);
      }
      break;
    case "lock":
      ui.menu = null;
      S.locked = !S.locked;
      void saveSettings();
      void applyWindow();
      break;
    case "open-web":
      ui.menu = null;
      void openUrl(`${S.projectUrl}/?view=mine`);
      break;
    case "hide":
      ui.menu = null;
      void hideWindow();
      break;
    case "close-panel":
      ui.panel = null;
      break;
    case "set": {
      const k = el.dataset.k as "windowMode" | "theme";
      (S as unknown as Record<string, string>)[k] = el.dataset.v!;
      void saveSettings();
      if (k === "windowMode") void applyWindow();
      break;
    }
    case "logout":
      await backend.logout();
      await sync.resetAll();
      ui.panel = "login";
      ui.login = { email: "", busy: false, error: "" };
      break;
    case "save-endpoints": {
      const a = (document.getElementById("set-auth") as HTMLInputElement).value.trim();
      const p = (document.getElementById("set-project") as HTMLInputElement).value.trim();
      if (a) S.authUrl = a.replace(/\/+$/, "");
      if (p) S.projectUrl = p.replace(/\/+$/, "");
      await backend.setEndpoints(S.authUrl, S.projectUrl);
      await saveSettings();
      showToast("Адреса сохранены");
      void sync.sync();
      break;
    }
    case "toast":
      ui.toast?.action?.fn();
      ui.toast = null;
      break;
    // ----- контекстное меню задачи
    case "open-task":
      ui.menu = null;
      void openUrl(`${S.projectUrl}/?view=all&task=${encodeURIComponent(ref)}`);
      break;
    case "rename":
      ui.menu = null;
      ui.editing = ref;
      render();
      (document.getElementById("edit-input") as HTMLInputElement | null)?.select();
      return;
    case "prio":
      sync.patch(ref, { priority: el.dataset.p as Priority });
      ui.menu = null;
      break;
    case "due": {
      const d = el.dataset.d!;
      sync.patch(ref, { due_at: d === "x" ? null : dueOn(addDays(new Date(), Number(d))) });
      ui.menu = null;
      break;
    }
    case "move":
      sync.patch(ref, { list_id: Number(el.dataset.list) });
      ui.menu = null;
      break;
    case "wontdo":
      sync.setStatus(ref, "done", true);
      ui.menu = null;
      showToast("Отмечено «не буду делать»", { label: "Отменить", fn: () => sync.setStatus(ref, "open") });
      break;
  }
  render();
});

app.addEventListener("dblclick", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>(".ttl");
  const ref = t?.closest<HTMLElement>("[data-ref]")?.dataset.ref;
  if (!ref) return;
  ui.expanded.delete(ref);
  ui.editing = ref;
  render();
  (document.getElementById("edit-input") as HTMLInputElement | null)?.select();
});

app.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const row = (e.target as HTMLElement).closest<HTMLElement>("[data-ref]");
  if (!row) return;
  const box = app.getBoundingClientRect();
  ui.menu = { kind: "task", ref: row.dataset.ref!, x: e.clientX - box.left, y: e.clientY - box.top };
  render();
});

app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "new-input") ui.newText = t.value;
  if (t.id === "login-email") ui.login.email = t.value;
  const range = t.dataset.range as "opacity" | "fontScale" | undefined;
  if (range) {
    S[range] = Number(t.value) / 100;
    document.documentElement.style.setProperty(range === "opacity" ? "--alpha" : "--scale", String(S[range]));
    const label = t.previousElementSibling as HTMLElement | null;
    if (label) label.textContent = label.textContent!.replace(/\d+%/, `${t.value}%`);
    void saveSettings();
  }
});

app.addEventListener("change", async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.select === "defaultListId") {
    S.defaultListId = t.value ? Number(t.value) : null;
    void saveSettings();
  }
  const chk = t.dataset.check;
  if (chk === "autostart" && isTauri) {
    const a = await import("@tauri-apps/plugin-autostart");
    await (t.checked ? a.enable() : a.disable()).catch(() => {});
    ui.autostart = await a.isEnabled().catch(() => false);
  } else if (chk === "locked" || chk === "allWorkspaces") {
    S[chk] = t.checked;
    void saveSettings();
    void applyWindow();
    render();
  }
});

app.addEventListener("keydown", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "new-input") {
    if (e.key === "Enter") {
      e.preventDefault();
      createFromInput();
    } else if (e.key === "Escape") {
      ui.newText = "";
      t.blur();
      render();
    }
  } else if (t.id === "edit-input") {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      ui.editing = null;
      render();
    }
  }
});

app.addEventListener(
  "blur",
  (e) => {
    if ((e.target as HTMLElement).id === "edit-input" && ui.editing) commitEdit();
  },
  true,
);

app.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = (document.getElementById("login-email") as HTMLInputElement).value.trim();
  const pass = (document.getElementById("login-pass") as HTMLInputElement).value;
  if (email && pass) void doLogin(email, pass);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (ui.menu) ui.menu = null;
  else if (ui.panel === "settings") ui.panel = null;
  else return;
  render();
});

// ---------------------------------------------------------------- старт

async function main() {
  if (!isTauri) document.body.classList.add("web");
  ({ backend, kv } = await createBackend());
  S = { ...DEFAULT_SETTINGS, ...((await kv.get<Settings>("settings")) ?? {}) };
  await backend.setEndpoints(S.authUrl, S.projectUrl);
  sync = new Sync(backend, kv);
  await sync.init();
  ui.login.email = sync.me?.email ?? "";

  let lastState = sync.state;
  sync.on(() => {
    if (sync.state === "auth" && lastState !== "auth") {
      ui.panel = "login";
      ui.login.email = sync.me?.email ?? ui.login.email;
    }
    lastState = sync.state;
    // пока человек редактирует название, не перерисовываем список под ним
    if (!ui.editing) render();
  });

  const hasSession = await backend.hasSession();
  if (!hasSession) ui.panel = "login";
  render();
  await applyWindow();
  if (hasSession) void sync.sync();

  (window as unknown as { __widgetSync: () => void }).__widgetSync = () => void sync.sync();

  // фоновая синхронизация
  let last = Date.now();
  const tick = () => {
    if (ui.panel === "login") return;
    last = Date.now();
    void sync.sync();
  };
  window.setInterval(tick, 60_000);
  window.addEventListener("online", tick);
  window.addEventListener("focus", () => {
    if (Date.now() - last > 15_000) tick();
  });
  // раз в минуту перерисовываем, чтобы «Сегодня/Завтра» менялись после полуночи
  window.setInterval(() => {
    if (!ui.editing && !ui.menu) render();
  }, 60_000);
}

void main();
