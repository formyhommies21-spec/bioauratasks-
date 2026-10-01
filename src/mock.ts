// Мок-бэкенд для разработки интерфейса в обычном браузере (npm run dev).
// window.__mockOffline = true имитирует отсутствие сети.

import type { Backend, KV, Resp } from "./backend";
import type { Task, TaskList } from "./types";

const lists: TaskList[] = [
  { id: 1, name: "Деньги", color: "#5CB88A", emoji: "💰", sort_order: 1 },
  { id: 2, name: "Документы", color: "#5B8DEF", emoji: "📄", sort_order: 2 },
  { id: 3, name: "Общее", color: "#9A9A9A", emoji: "🏠", sort_order: 3 },
];

const iso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
};

let seq = 200;
const mk = (title: string, list: number, extra: Partial<Task> = {}): Task => ({
  id: ++seq,
  short_id: `t${seq}`,
  title,
  description_md: null,
  list_id: list,
  project_id: null,
  assignee_id: 4,
  assignee2_id: null,
  priority: "none",
  status: "open",
  wont_do: false,
  due_at: null,
  start_at: null,
  sort_order: 0,
  ...extra,
});

const tasks: Task[] = [
  mk("Олибанум заказать", 1, { due_at: iso(-2), priority: "high" }),
  mk("Набрать типу по аппарату розлива и узнать сроки", 1, { due_at: iso(0) }),
  mk("На Озоне в кредите подать заявку с флешки", 1, { due_at: iso(1), priority: "medium" }),
  mk("Заказать и поправить карточку на Амазоне", 1),
  mk("Набрать химическую экспертизу, лаборатория", 1, { due_at: iso(9) }),
  mk("Забрать у Артёма флешку ИП и подписать", 2, { description_md: "Флешка с ЭЦП, подписать договоры с поставщиком." }),
  mk("Закончить таблицу с готовыми БАДами", 2, { due_at: iso(3), priority: "low" }),
  mk("Подать СГР на регистрацию", 2, { priority: "high" }),
  mk("Чужая задача Алины", 3, { assignee_id: 2 }),
];

export function createMock(): { backend: Backend; kv: KV } {
  let session = localStorage.getItem("mock.session") === "1";
  const offline = () =>
    (window as unknown as { __mockOffline?: boolean }).__mockOffline === true || localStorage.getItem("mock.offline") === "1";
  const ok = <T>(data: T, status = 200): Resp<T> => ({ status, data });
  const delay = () => new Promise((r) => setTimeout(r, 120));

  const backend: Backend = {
    hasSession: async () => session,
    setEndpoints: async () => {},
    login: async (email, password) => {
      await delay();
      if (offline()) return ok("offline", 0);
      if (password !== "test") return ok({ detail: "Неверный email или пароль" }, 401);
      session = true;
      localStorage.setItem("mock.session", "1");
      return ok({ ok: true, email });
    },
    logout: async () => {
      session = false;
      localStorage.removeItem("mock.session");
    },
    api: async <T>(method: string, path: string, body?: unknown): Promise<Resp<T>> => {
      await delay();
      if (offline()) return ok("offline" as T, 0);
      if (!session) return ok({ detail: "Not authenticated" } as T, 401);
      if (method === "GET" && path === "/api/auth/me") return ok({ id: 4, email: "daniil@example.com", name: "Даниил" } as T);
      if (method === "GET" && path === "/api/lists") return ok(lists as T);
      if (method === "GET" && path.startsWith("/api/tasks")) {
        const rows = tasks.filter((t) => t.status === "open");
        return ok({ rows, total: rows.length, offset: 0, limit: 500 } as T);
      }
      if (method === "POST" && path === "/api/tasks") {
        const t = mk((body as Task).title, 0, body as Partial<Task>);
        tasks.push(t);
        return ok(t as T, 201);
      }
      const m = path.match(/^\/api\/tasks\/(t\d+)(\/status)?$/);
      if (m && method === "PATCH") {
        const t = tasks.find((x) => x.short_id === m[1]);
        if (!t) return ok({ detail: "not found" } as T, 404);
        Object.assign(t, body);
        return ok(t as T);
      }
      return ok({ detail: "not found" } as T, 404);
    },
  };

  const kv: KV = {
    get: async <T>(k: string) => {
      const v = localStorage.getItem("mock.kv." + k);
      return v ? (JSON.parse(v) as T) : undefined;
    },
    set: async (k, v) => localStorage.setItem("mock.kv." + k, JSON.stringify(v)),
    delete: async (k) => localStorage.removeItem("mock.kv." + k),
  };
  return { backend, kv };
}
