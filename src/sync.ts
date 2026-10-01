// Офлайн-синхронизация.
//
// serverTasks — последний снимок с сервера (хранится на диске).
// outbox      — очередь локальных изменений, ещё не отправленных.
// Что видит пользователь = serverTasks + применённые поверх операции из outbox.
// Поэтому после любого pull локальные правки не «откатываются», пока не уйдут.

import type { Backend, KV } from "./backend";
import type { Me, Op, Task, TaskList } from "./types";

type Listener = () => void;

export type SyncState = "idle" | "syncing" | "offline" | "auth" | "error";

interface Cache {
  ownerId: number | null;
  me: Me | null;
  lists: TaskList[];
  tasks: Task[];
  syncedAt: string | null;
}

const EMPTY: Cache = { ownerId: null, me: null, lists: [], tasks: [], syncedAt: null };

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class Sync {
  cache: Cache = { ...EMPTY };
  outbox: Op[] = [];
  state: SyncState = "idle";
  lastError: string | null = null;
  private listeners = new Set<Listener>();
  private running: Promise<void> | null = null;
  private again = false;
  private flushTimer: number | undefined;

  constructor(private backend: Backend, private kv: KV) {}

  async init() {
    this.cache = { ...EMPTY, ...((await this.kv.get<Cache>("cache")) ?? {}) };
    this.outbox = (await this.kv.get<Op[]>("outbox")) ?? [];
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async save() {
    await this.kv.set("cache", this.cache);
    await this.kv.set("outbox", this.outbox);
  }

  // ---------- что показываем ----------

  get tasks(): Task[] {
    let rows = this.cache.tasks.map((t) => ({ ...t }));
    for (const op of this.outbox) rows = applyOp(rows, op);
    return rows;
  }

  get me() {
    return this.cache.me;
  }

  get lists() {
    return [...this.cache.lists].sort((a, b) => a.sort_order - b.sort_order);
  }

  // ---------- локальные действия ----------

  private enqueue(op: Op) {
    this.outbox.push(op);
    void this.save();
    this.emit();
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.sync(), 300);
  }

  create(body: Partial<Task>) {
    const tempId = "tmp_" + uid();
    this.enqueue({ id: uid(), kind: "create", tempId, body });
    return tempId;
  }

  setStatus(ref: string, status: "open" | "done", wontDo = false) {
    this.enqueue({ id: uid(), kind: "status", ref, status, wontDo });
  }

  patch(ref: string, fields: Partial<Task>) {
    this.enqueue({ id: uid(), kind: "patch", ref, fields });
  }

  // ---------- авторизация ----------

  /** Вызывается после успешного логина: если вошёл другой человек, чистим чужое. */
  async adoptUser(me: Me) {
    if (this.cache.ownerId !== null && this.cache.ownerId !== me.id) {
      this.cache = { ...EMPTY };
      this.outbox = [];
    }
    this.cache.ownerId = me.id;
    this.cache.me = me;
    this.state = "idle";
    await this.save();
    this.emit();
  }

  async resetAll() {
    this.cache = { ...EMPTY };
    this.outbox = [];
    await this.save();
    this.emit();
  }

  // ---------- синхронизация ----------

  /** Отправить очередь и забрать свежие данные. Повторные вызовы склеиваются. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private setState(s: SyncState, err: string | null = null) {
    this.state = s;
    this.lastError = err;
    this.emit();
  }

  private async runOnce() {
    this.setState("syncing");
    const flushed = await this.flush();
    if (flushed !== "ok") return;

    const [me, lists, tasks] = await Promise.all([
      this.backend.api<Me>("GET", "/api/auth/me"),
      this.backend.api<TaskList[]>("GET", "/api/lists"),
      this.backend.api<{ rows: Task[] }>("GET", "/api/tasks?sort=due&limit=500"),
    ]);
    for (const r of [me, lists, tasks]) {
      if (r.status === 0) return this.setState("offline");
      if (r.status === 401) return this.setState("auth");
      if (r.status >= 400) return this.setState("error", errText(r));
    }
    const meData = me.data as Me;
    if (this.cache.ownerId !== null && this.cache.ownerId !== meData.id) {
      // Сессия принадлежит другому пользователю: чужой кэш не показываем
      this.cache = { ...EMPTY };
      this.outbox = [];
    }
    this.cache.ownerId = meData.id;
    this.cache.me = { id: meData.id, email: meData.email, name: meData.name };
    this.cache.lists = lists.data as TaskList[];
    this.cache.tasks = (tasks.data as { rows: Task[] }).rows;
    this.cache.syncedAt = new Date().toISOString();
    await this.save();
    this.setState("idle");
  }

  /** Отправляет очередь по одной операции. Останавливается при отсутствии сети. */
  private async flush(): Promise<"ok" | "stopped"> {
    while (this.outbox.length) {
      const op = this.outbox[0];
      let r: { status: number; data: unknown };
      if (op.kind === "create") {
        r = await this.backend.api("POST", "/api/tasks", op.body);
      } else if (op.ref.startsWith("tmp_")) {
        // Создание этой задачи не прошло, операция над ней бессмысленна
        this.outbox.shift();
        continue;
      } else if (op.kind === "status") {
        r = await this.backend.api("PATCH", `/api/tasks/${op.ref}/status`, {
          status: op.status,
          wont_do: op.wontDo,
        });
      } else {
        r = await this.backend.api("PATCH", `/api/tasks/${op.ref}`, op.fields);
      }

      if (r.status === 0) {
        this.setState("offline");
        return "stopped";
      }
      if (r.status === 401) {
        this.setState("auth");
        return "stopped";
      }
      if (r.status >= 500) {
        this.setState("error", errText(r));
        return "stopped";
      }

      this.outbox.shift();
      if (r.status >= 400) {
        // Сервер отверг операцию (нет прав, задача удалена и т.п.): выкидываем
        this.lastError = errText(r);
      } else if (op.kind === "create") {
        const created = r.data as Task | undefined;
        if (created?.short_id) {
          for (const o of this.outbox) if ("ref" in o && o.ref === op.tempId) o.ref = created.short_id;
          this.cache.tasks.push(created);
        }
      } else {
        const updated = r.data as Task | undefined;
        if (updated && typeof updated === "object" && "short_id" in updated) {
          this.cache.tasks = this.cache.tasks.map((t) => (t.short_id === updated.short_id ? updated : t));
        } else {
          this.cache.tasks = applyOp(this.cache.tasks, op);
        }
      }
      await this.save();
      this.emit();
    }
    return "ok";
  }
}

function applyOp(rows: Task[], op: Op): Task[] {
  if (op.kind === "create") {
    const t: Task = {
      id: -1,
      short_id: op.tempId,
      title: "",
      description_md: null,
      list_id: null,
      project_id: null,
      assignee_id: null,
      assignee2_id: null,
      priority: "none",
      status: "open",
      wont_do: false,
      due_at: null,
      start_at: null,
      sort_order: 0,
      ...op.body,
      _pending: true,
    };
    return [...rows, t];
  }
  return rows.map((t) => {
    if (t.short_id !== op.ref) return t;
    if (op.kind === "status") return { ...t, status: op.status, wont_do: op.wontDo };
    return { ...t, ...op.fields };
  });
}

function errText(r: { status: number; data: unknown }) {
  const d = r.data as { detail?: unknown } | string | null;
  if (d && typeof d === "object" && "detail" in d) return `${r.status}: ${JSON.stringify(d.detail)}`;
  return `${r.status}: ${typeof d === "string" ? d.slice(0, 200) : ""}`;
}
