/**
 * A minimal tRPC-over-HTTP client for load bots: the same endpoints, headers,
 * superjson encoding and SSE subscriptions the browser uses, without React.
 */
import superjson from "superjson";

export class TrpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export type PathCounters = { requests: number; bytes: number; events: number };

export type Counters = {
  requests: number;
  bytes: number;
  streamsOpen: number;
  streamsOpened: number;
  streamEvents: number;
  /** The same, per API path, to see which calls carry the traffic. */
  paths?: Record<string, PathCounters>;
};

function pathCounters(counters: Counters, path: string): PathCounters {
  counters.paths ??= {};
  return (counters.paths[path] ??= { requests: 0, bytes: 0, events: 0 });
}

export type Identity = {
  gameId?: string;
  gameUserToken?: string;
  sessionToken?: string;
  /** Distinct client address per bot (local runs only). */
  forwardedFor?: string;
};

type ErrorShape = {
  json?: {
    message?: string;
    data?: { code?: string; httpStatus?: number };
  };
};

export class TrpcHttp {
  constructor(
    private readonly origin: string,
    private readonly identity: Identity,
    private readonly counters: Counters,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra };
    if (this.identity.gameId) h["x-buzz-board-game-id"] = this.identity.gameId;
    if (this.identity.gameUserToken) {
      h["x-buzz-board-game-user-token"] = this.identity.gameUserToken;
    }
    if (this.identity.sessionToken) {
      h.cookie = `authjs.session-token=${this.identity.sessionToken}`;
    }
    if (this.identity.forwardedFor) {
      h["x-forwarded-for"] = this.identity.forwardedFor;
    }
    return h;
  }

  private async parse<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    this.counters.bytes += text.length;
    pathCounters(this.counters, path).bytes += text.length;
    let body: {
      result?: { data: Parameters<typeof superjson.deserialize>[0] };
      error?: ErrorShape;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new TrpcError(
        `HTTP ${res.status}: not JSON`,
        "INTERNAL_SERVER_ERROR",
        res.status,
      );
    }
    if (body.error) {
      const e = body.error.json;
      throw new TrpcError(
        e?.message ?? "Unknown error",
        e?.data?.code ?? "INTERNAL_SERVER_ERROR",
        e?.data?.httpStatus ?? res.status,
      );
    }
    return superjson.deserialize<T>(body.result!.data);
  }

  async query<T>(path: string, input?: unknown): Promise<T> {
    this.counters.requests++;
    pathCounters(this.counters, path).requests++;
    const qs =
      input === undefined
        ? ""
        : `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;
    const res = await fetch(`${this.origin}/api/trpc/${path}${qs}`, {
      headers: this.headers(),
      redirect: "manual",
    });
    return this.parse<T>(res, path);
  }

  async mutation<T>(path: string, input?: unknown): Promise<T> {
    this.counters.requests++;
    pathCounters(this.counters, path).requests++;
    const res = await fetch(`${this.origin}/api/trpc/${path}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body:
        input === undefined
          ? undefined
          : JSON.stringify(superjson.serialize(input)),
      redirect: "manual",
    });
    return this.parse<T>(res, path);
  }

  /**
   * Opens a subscription and calls `onData` for each value. Resolves when
   * the stream ends; rejects with the server's error (for example removal).
   */
  async subscribe<T>(
    path: string,
    input: unknown,
    onData: (value: T) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const qs = `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input ?? {})))}`;
    this.counters.requests++;
    const per = pathCounters(this.counters, path);
    per.requests++;
    const res = await fetch(`${this.origin}/api/trpc/${path}${qs}`, {
      headers: this.headers({ accept: "text/event-stream" }),
      signal,
      redirect: "manual",
    });
    if (!res.ok || !res.body) {
      throw new TrpcError(
        `Stream ${path} failed: HTTP ${res.status}`,
        "STREAM",
        res.status,
      );
    }
    this.counters.streamsOpen++;
    this.counters.streamsOpened++;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        this.counters.bytes += value.byteLength;
        per.bytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trim());
          }
          if (event === "return") return;
          // "connected" and "ping" carry no value (ping's data is empty).
          if (event !== "message" && event !== "serialized-error") continue;
          if (data.join("").length === 0) continue;
          const payload = JSON.parse(data.join("\n")) as unknown;
          if (event === "serialized-error") {
            const e = payload as ErrorShape;
            throw new TrpcError(
              e.json?.message ?? "Stream error",
              e.json?.data?.code ?? "STREAM",
              e.json?.data?.httpStatus ?? 500,
            );
          }
          this.counters.streamEvents++;
          per.events++;
          onData(
            superjson.deserialize<T>(
              payload as Parameters<typeof superjson.deserialize>[0],
            ),
          );
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    } finally {
      this.counters.streamsOpen--;
      reader.releaseLock();
    }
  }
}
