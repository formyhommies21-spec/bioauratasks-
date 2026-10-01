// Слой связи с Rust-частью (HTTP, сессия) и с локальным хранилищем.
// Вне Tauri (в обычном браузере) подставляется мок, чтобы можно было
// верстать и тестировать интерфейс без сборки приложения.

export interface Resp<T = unknown> {
  /** 0 = нет сети */
  status: number;
  data: T;
}

export interface Backend {
  hasSession(): Promise<boolean>;
  setEndpoints(auth: string, project: string): Promise<void>;
  login(email: string, password: string): Promise<Resp>;
  logout(): Promise<void>;
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<Resp<T>>;
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function createBackend(): Promise<{ backend: Backend; kv: KV }> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("widget.json", { autoSave: 200, defaults: {} });
    const backend: Backend = {
      hasSession: () => invoke<boolean>("session_status"),
      setEndpoints: (auth, project) => invoke("set_endpoints", { auth, project }),
      login: (email, password) => invoke<Resp>("auth_login", { email, password }),
      logout: () => invoke("auth_logout"),
      api: (method, path, body) => invoke("api", { method, path, body: body ?? null }),
    };
    const kv: KV = {
      get: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      delete: async (k) => {
        await store.delete(k);
      },
    };
    return { backend, kv };
  }
  const { createMock } = await import("./mock");
  return createMock();
}
