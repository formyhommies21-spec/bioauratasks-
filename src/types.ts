export type Priority = "none" | "low" | "medium" | "high";

export interface Task {
  id: number;
  short_id: string;
  title: string;
  description_md?: string | null;
  list_id: number | null;
  project_id: number | null;
  assignee_id: number | null;
  assignee2_id: number | null;
  priority: Priority;
  status: string; // open | done
  wont_do: boolean;
  due_at: string | null;
  start_at: string | null;
  sort_order: number;
  updated_at?: string;
  /** Задача создана офлайн и ещё не ушла на сервер */
  _pending?: boolean;
}

export interface TaskList {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  sort_order: number;
  open_count?: number;
}

export interface Me {
  id: number;
  email: string;
  name: string;
}

export type ViewKey = "mine" | "today" | "all" | `list:${number}`;

export type WindowMode = "normal" | "top" | "bottom";

export interface Settings {
  view: ViewKey;
  windowMode: WindowMode;
  opacity: number; // 0.4..1
  fontScale: number; // 0.85..1.3
  theme: "dark" | "light";
  locked: boolean;
  allWorkspaces: boolean;
  defaultListId: number | null;
  collapsed: Record<string, boolean>;
  authUrl: string;
  projectUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  view: "mine",
  windowMode: "normal",
  opacity: 0.92,
  fontScale: 1,
  theme: "dark",
  locked: false,
  allWorkspaces: false,
  defaultListId: null,
  collapsed: {},
  authUrl: "https://organism.resetaura.io",
  projectUrl: "https://project.resetaura.io",
};

export type Op =
  | { id: string; kind: "create"; tempId: string; body: Partial<Task> }
  | { id: string; kind: "status"; ref: string; status: string; wontDo: boolean }
  | { id: string; kind: "patch"; ref: string; fields: Partial<Task> };
