import type { ClientOptions } from "./types.js";

export class HttpError extends Error {
  public constructor(message: string, public readonly status: number, public readonly url: string, public readonly responseBody: string, public readonly retryAfterMs: number | null = null) {
    super(message); this.name = "HttpError";
  }
}
export class ContentUnavailableError extends Error {
  public constructor(message: string, public readonly url: string) { super(message); this.name = "ContentUnavailableError"; }
}
interface CacheEntry { value: string; expiresAt: number; }
class Semaphore {
  private active = 0; private readonly queue: Array<() => void> = [];
  public constructor(private readonly limit: number) {}
  public async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (this.active < this.limit) { this.active += 1; return () => this.release(); }
    return new Promise((resolve, reject) => {
      const grant = (): void => { cleanup(); this.active += 1; resolve(() => this.release()); };
      const abort = (): void => { const index = this.queue.indexOf(grant); if (index >= 0) this.queue.splice(index, 1); cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      const cleanup = (): void => signal?.removeEventListener("abort", abort);
      this.queue.push(grant); signal?.addEventListener("abort", abort, { once: true });
    });
  }
  private release(): void { this.active -= 1; this.queue.shift()?.(); }
}
class RateGate {
  private tail: Promise<void> = Promise.resolve(); private nextAt = 0;
  public constructor(private readonly intervalMs: number) {}
  public async wait(signal?: AbortSignal): Promise<void> {
    let release!: () => void; const previous = this.tail; this.tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
    try { const delay = Math.max(0, this.nextAt - Date.now()); if (delay > 0) await sleep(delay, signal); this.nextAt = Date.now() + this.intervalMs; } finally { release(); }
  }
}
export class HttpTransport {
  private readonly baseUrl: string; private readonly timeoutMs: number; private readonly maxResponseBytes: number; private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number; private readonly retryMaxDelayMs: number; private readonly metadataCacheTtlMs: number; private readonly chapterCacheTtlMs: number;
  private readonly fetchImpl: typeof fetch; private readonly defaultHeaders: Record<string, string>; private readonly semaphore: Semaphore; private readonly gate: RateGate;
  private readonly cache = new Map<string, CacheEntry>(); private readonly inFlight = new Map<string, Promise<string>>();
  public constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://tl.rulate.ru").replace(/\/+$/, ""); this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 32 * 1024 * 1024; this.maxRetries = options.maxRetries ?? 5; this.retryBaseDelayMs = options.retryBaseDelayMs ?? 600;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 30_000; this.metadataCacheTtlMs = options.metadataCacheTtlMs ?? 5 * 60_000; this.chapterCacheTtlMs = options.chapterCacheTtlMs ?? 0;
    this.fetchImpl = options.fetch ?? globalThis.fetch; if (!this.fetchImpl) throw new Error("Fetch API is required (Node.js 20+ includes it).");
    this.semaphore = new Semaphore(Math.max(1, options.maxConcurrency ?? 12)); this.gate = new RateGate(Math.max(0, options.minRequestIntervalMs ?? 80));
    this.defaultHeaders = { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "ru,en;q=0.8", "User-Agent": options.userAgent ?? "@iooe/rulate-sdk/0.1.0", ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.headers ?? {}) };
  }
  public resolve(pathOrUrl: string): string { return new URL(pathOrUrl, `${this.baseUrl}/`).toString(); }
  public getMetadata(pathOrUrl: string, options: { signal?: AbortSignal; refresh?: boolean; headers?: Record<string, string> } = {}): Promise<string> { return this.get(pathOrUrl, { ...options, cacheTtlMs: this.metadataCacheTtlMs }); }
  public getChapter(pathOrUrl: string, options: { signal?: AbortSignal; refresh?: boolean; headers?: Record<string, string> } = {}): Promise<string> { return this.get(pathOrUrl, { ...options, cacheTtlMs: this.chapterCacheTtlMs }); }
  public async getJsonish(pathOrUrl: string, options: { signal?: AbortSignal; refresh?: boolean; headers?: Record<string, string>; chapter?: boolean } = {}): Promise<unknown> {
    const text = options.chapter ? await this.getChapter(pathOrUrl, options) : await this.getMetadata(pathOrUrl, options); if (text.trim() === "") return null;
    try { return JSON.parse(text) as unknown; } catch (error) { throw new Error(`Expected JSON from ${this.resolve(pathOrUrl)}: ${String(error)}`); }
  }
  public clearCache(): void { this.cache.clear(); }
  public close(): void { this.clearCache(); this.inFlight.clear(); }
  private get(pathOrUrl: string, options: { signal?: AbortSignal; refresh?: boolean; headers?: Record<string, string>; cacheTtlMs: number }): Promise<string> {
    const url = this.resolve(pathOrUrl); const headerKey = Object.entries(options.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join("|"); const key = `${url}|${headerKey}`;
    if (!options.refresh) {
      const cached = this.cache.get(key); if (cached && cached.expiresAt > Date.now()) { this.cache.delete(key); this.cache.set(key, cached); return Promise.resolve(cached.value); }
      if (cached) this.cache.delete(key); const existing = this.inFlight.get(key); if (existing) return existing;
    }
    const request = this.requestWithRetries(url, options.headers ?? {}, options.signal).then((value) => {
      if (options.cacheTtlMs > 0) { this.cache.set(key, { value, expiresAt: Date.now() + options.cacheTtlMs }); while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string); }
      return value;
    }).finally(() => this.inFlight.delete(key)); this.inFlight.set(key, request); return request;
  }
  private async requestWithRetries(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
    let lastError: unknown; for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) { try { return await this.requestOnce(url, headers, signal); } catch (error) {
      lastError = error; if (!this.shouldRetry(error, attempt, signal)) throw error; const retryAfter = error instanceof HttpError ? error.retryAfterMs : null;
      const exponential = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** attempt); const delay = retryAfter ?? Math.round(exponential * (0.8 + Math.random() * 0.4)); await sleep(delay, signal);
    }} throw lastError;
  }
  private async requestOnce(url: string, headers: Record<string, string>, outerSignal?: AbortSignal): Promise<string> {
    const release = await this.semaphore.acquire(outerSignal); try { await this.gate.wait(outerSignal); const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(new DOMException("Request timeout", "TimeoutError")), this.timeoutMs); const signal = mergeSignals(outerSignal, timeoutController.signal);
      try { const request: RequestInit = { method: "GET", headers: { ...this.defaultHeaders, Referer: new URL("/", url).toString(), ...headers }, redirect: "follow" }; if (signal) request.signal = signal;
        const response = await this.fetchImpl(url, request); const body = await readText(response, this.maxResponseBytes, url); if (response.ok) return body;
        throw new HttpError(`HTTP ${response.status} from ${url}`, response.status, url, body.slice(0, 2_000), parseRetryAfter(response.headers.get("retry-after")));
      } finally { clearTimeout(timeout); }
    } finally { release(); }
  }
  private shouldRetry(error: unknown, attempt: number, signal?: AbortSignal): boolean {
    if (attempt >= this.maxRetries || signal?.aborted) return false; if (error instanceof HttpError) return [408, 425, 429].includes(error.status) || error.status >= 500;
    return error instanceof TypeError || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
  }
}
async function readText(response: Response, limit: number, url: string): Promise<string> {
  const declared = Number(response.headers.get("content-length")); if (Number.isFinite(declared) && declared > limit) throw new Error(`Response from ${url} exceeds ${limit} bytes.`); if (!response.body) return response.text();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0; try { while (true) { const { done, value } = await reader.read(); if (done) break; if (!value) continue; total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error(`Response from ${url} exceeds ${limit} bytes.`); } chunks.push(value); }} finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder().decode(output);
}
function parseRetryAfter(value: string | null): number | null { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000); const time = Date.parse(value); return Number.isFinite(time) ? Math.max(0, time - Date.now()) : null; }
function mergeSignals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined { if (!first) return second; if (!second) return first; if (first.aborted) return first; if (second.aborted) return second; const controller = new AbortController();
  const abort = (source: AbortSignal): void => { if (!controller.signal.aborted) controller.abort(source.reason); }; first.addEventListener("abort", () => abort(first), { once: true }); second.addEventListener("abort", () => abort(second), { once: true }); return controller.signal; }
export function sleep(ms: number, signal?: AbortSignal): Promise<void> { if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms); const abort = (): void => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); }; signal?.addEventListener("abort", abort, { once: true }); }); }
