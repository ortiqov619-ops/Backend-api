import type { ApiErrorBody, ApiErrorCode } from '../contract/common';

/**
 * Minimal, bog'liqliksiz HTTP qatlami (global `fetch` ustida).
 * Admin va foydalanuvchi ilovalari bir xil xatolik semantikasini oladi.
 */

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(params: { code: ApiErrorCode; status: number; message: string; fields?: Record<string, string[]>; requestId?: string }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.fields = params.fields;
    this.requestId = params.requestId;
  }

  /** Foydalanuvchiga ko'rsatish uchun o'zbekcha xabar. */
  get userMessage(): string {
    switch (this.code) {
      case 'unauthorized':
        return this.message || 'Sessiya tugadi. Qaytadan kiring.';
      case 'forbidden':
        return 'Bu amal uchun ruxsatingiz yo‘q.';
      case 'rate_limited':
        return 'Juda ko‘p so‘rov yuborildi. Biroz kutib turing.';
      case 'location_outside_geofence':
        return 'Yangi hissa qo‘shish hozircha faqat Xorazm hududidan mumkin.';
      case 'location_low_accuracy':
      case 'location_stale':
        return 'Joylashuvni qayta aniqlab, qayta urinib ko‘ring.';
      case 'conflict':
        return 'Bu yozuv boshqa moderator tomonidan o‘zgartirilgan. Ro‘yxatni yangilang.';
      case 'provider_unavailable':
        return this.message || 'Tashqi xizmat vaqtincha ishlamayapti.';
      default:
        return this.message || 'Kutilmagan xatolik yuz berdi.';
    }
  }
}

export interface TokenProvider {
  getAccessToken(): string | null | Promise<string | null>;
  /** 401 kelganda bir marta chaqiriladi. Yangi token qaytarsa, so'rov takrorlanadi. */
  onUnauthorized?(): Promise<string | null>;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  tokens?: TokenProvider;
  /** Loglash/telemetriya uchun ilova nomi. */
  userAgent?: string;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** `FormData` yuborilsa `Content-Type` qo'lda qo'yilmaydi. */
  formData?: FormData;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** `false` — Authorization sarlavhasini qo'shmaslik (public endpointlar). */
  auth?: boolean;
}

export interface BackendWarmupOptions {
  /** Render Free sovuq ishga tushishi uchun umumiy kutish chegarasi. */
  timeoutMs?: number;
  /** Har bir health so'rovining eng uzun davomiyligi. */
  attemptTimeoutMs?: number;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

function backendHealthUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v3$/, '');
  return `${root}/health`;
}

const activeWarmups = new Map<string, Promise<void>>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uxlayotgan backendni maxfiy ma'lumotsiz `/health` orqali uyg'otadi.
 * Bir vaqtda bir necha ekran chaqirsa ham tarmoqqa faqat bitta oqim ketadi.
 */
export function warmBackend(baseUrl: string, options: BackendWarmupOptions = {}): Promise<void> {
  const healthUrl = backendHealthUrl(baseUrl);
  const existing = activeWarmups.get(healthUrl);
  if (existing) return existing;

  const task = (async () => {
    const deadline = Date.now() + (options.timeoutMs ?? 90_000);
    let lastStatus: number | null = null;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const remaining = deadline - Date.now();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(250, Math.min(options.attemptTimeoutMs ?? 20_000, remaining)),
      );
      try {
        const response = await fetch(healthUrl, {
          method: 'GET',
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });
        lastStatus = response.status;
        if (response.ok) return;
      } catch {
        // Cold-start, DNS almashinuvi va qisqa uzilishlarda deadlinegacha uriniladi.
      } finally {
        clearTimeout(timeout);
      }
      if (Date.now() < deadline) await wait(1_200);
    }
    throw new ApiError({
      code: 'provider_unavailable',
      status: lastStatus ?? 0,
      message: lastStatus
        ? `Server ishga tushmadi (HTTP ${lastStatus}). Birozdan so‘ng qayta urinib ko‘ring.`
        : 'Serverga ulanib bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.',
    });
  })();

  activeWarmups.set(healthUrl, task);
  void task.finally(() => {
    if (activeWarmups.get(healthUrl) === task) activeWarmups.delete(healthUrl);
  }).catch(() => undefined);
  return task;
}

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  warmup(options?: BackendWarmupOptions): Promise<void> {
    return warmBackend(this.options.baseUrl, options);
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>(method, path, opts, true);
  }

  private async send<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    allowRetry: boolean,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
    };
    if (this.options.userAgent) headers['X-Client'] = this.options.userAgent;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.auth !== false && this.options.tokens) {
      const token = await this.options.tokens.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (!opts.formData && opts.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      const response = await fetch(buildUrl(this.options.baseUrl, path, opts.query), {
        method,
        headers,
        body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: controller.signal,
      });

      if (response.status === 401 && allowRetry && this.options.tokens?.onUnauthorized) {
        const refreshed = await this.options.tokens.onUnauthorized();
        if (refreshed) return this.send<T>(method, path, opts, false);
      }

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new ApiError({
            code: 'internal_error',
            status: response.status,
            message: response.ok
              ? 'Server tushunarsiz javob qaytardi. Ilovani yangilab, qayta urinib ko‘ring.'
              : `Server vaqtincha javob bermadi (HTTP ${response.status}).`,
          });
        }
      }

      if (!response.ok) {
        if (isApiErrorBody(payload)) {
          throw new ApiError({
            code: payload.error.code,
            status: response.status,
            message: payload.error.message,
            fields: payload.error.fields,
            requestId: payload.error.requestId,
          });
        }
        throw new ApiError({
          code: response.status >= 500 ? 'internal_error' : 'bad_request',
          status: response.status,
          message: `So‘rov bajarilmadi (HTTP ${response.status}).`,
        });
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError({ code: 'internal_error', status: 0, message: 'So‘rov vaqti tugadi.' });
      }
      throw new ApiError({
        code: 'internal_error',
        status: 0,
        message: 'Serverga ulanib bo‘lmadi. Internet ishlayotgan bo‘lsa, birozdan so‘ng qayta urinib ko‘ring.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
