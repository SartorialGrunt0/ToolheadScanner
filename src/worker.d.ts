interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (event: ScheduledController, env: Env, ctx: ExecutionContext) => void | Promise<void>;
}