import { randomUUID } from "node:crypto";

export const deepSeekErrorCodes = [
  "AI_TIMEOUT",
  "AI_AUTH_FAILED",
  "AI_BALANCE_INSUFFICIENT",
  "AI_RATE_LIMITED",
  "AI_INVALID_RESPONSE",
  "AI_UNAVAILABLE"
] as const;

export type DeepSeekErrorCode = (typeof deepSeekErrorCodes)[number];

export type DeepSeekErrorOptions = {
  code: DeepSeekErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  upstreamStatus?: number;
  cause?: unknown;
};

export class DeepSeekError extends Error {
  readonly code: DeepSeekErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;

  constructor(options: DeepSeekErrorOptions) {
    super(options.message);
    this.name = "DeepSeekError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.upstreamStatus = options.upstreamStatus;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

type DeepSeekPayload = {
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null };
  }[];
  usage?: DeepSeekUsage;
};

export type DeepSeekEntrypoint =
  | "match-parse"
  | "roster-parse"
  | "roster-image-ocr"
  | "player-list-parse";

export type DeepSeekUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type RequestDeepSeekJsonOptions<T> = {
  entrypoint: DeepSeekEntrypoint;
  prompt: string;
  model?: string;
  userContent?: DeepSeekUserContentPart[];
  parseContent: (content: string) => T;
};

export type DeepSeekJsonResult<T> = {
  parsed: T;
  modelName: string;
  requestId: string;
};

const DEFAULT_ATTEMPT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 4_096;
const MAX_ATTEMPTS = 2;

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function isDeepSeekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

export function getDeepSeekModel() {
  return process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
}

function timeoutError(cause?: unknown) {
  return new DeepSeekError({
    code: "AI_TIMEOUT",
    message: "DeepSeek 响应等待超时，请稍后重试。",
    status: 504,
    retryable: true,
    cause
  });
}

function invalidResponseError(cause?: unknown) {
  return new DeepSeekError({
    code: "AI_INVALID_RESPONSE",
    message: "DeepSeek 连续返回了无法识别的结果，请稍后重试。",
    status: 502,
    retryable: true,
    cause
  });
}

function httpError(status: number) {
  if (status === 401) {
    return new DeepSeekError({
      code: "AI_AUTH_FAILED",
      message: "DeepSeek API Key 无效，请联系管理员检查服务器配置。",
      status: 502,
      retryable: false,
      upstreamStatus: status
    });
  }

  if (status === 402) {
    return new DeepSeekError({
      code: "AI_BALANCE_INSUFFICIENT",
      message: "DeepSeek 账户余额不足，请充值后重试。",
      status: 402,
      retryable: false,
      upstreamStatus: status
    });
  }

  if (status === 429) {
    return new DeepSeekError({
      code: "AI_RATE_LIMITED",
      message: "DeepSeek 请求过多，请稍后重试。",
      status: 429,
      retryable: true,
      upstreamStatus: status
    });
  }

  if (status >= 500) {
    return new DeepSeekError({
      code: "AI_UNAVAILABLE",
      message: "DeepSeek 服务暂时不可用，请稍后重试。",
      status: 503,
      retryable: true,
      upstreamStatus: status
    });
  }

  return new DeepSeekError({
    code: "AI_UNAVAILABLE",
    message:
      status === 422
        ? "DeepSeek 拒绝了当前请求，请联系管理员检查模型配置。"
        : "DeepSeek 请求失败，请联系管理员检查服务器配置。",
    status: 502,
    retryable: false,
    upstreamStatus: status
  });
}

function networkError(cause: unknown) {
  return new DeepSeekError({
    code: "AI_UNAVAILABLE",
    message: "无法连接 DeepSeek 服务，请检查服务器网络后重试。",
    status: 503,
    retryable: false,
    cause
  });
}

function safeLog(
  level: "info" | "warn",
  metadata: Record<string, string | number | boolean | null | undefined>
) {
  const logger = level === "warn" ? console.warn : console.info;
  logger("[deepseek]", metadata);
}

function normalizeAttemptError(error: unknown, didTimeout: boolean) {
  if (error instanceof DeepSeekError) return error;
  if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
    return timeoutError(error);
  }
  return networkError(error);
}

async function runAttempt<T>({
  apiKey,
  model,
  maxTokens,
  timeoutMs,
  requestId,
  attempt,
  entrypoint,
  prompt,
  userContent,
  parseContent
}: RequestDeepSeekJsonOptions<T> & {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  requestId: string;
  attempt: number;
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "Return valid JSON only. Do not return Markdown or explanation text."
            },
            {
              role: "user",
              content: userContent ?? prompt
            }
          ]
        })
      });
    } catch (error) {
      throw normalizeAttemptError(error, didTimeout);
    }

    if (didTimeout) throw timeoutError();

    if (!response.ok) throw httpError(response.status);

    let payload: DeepSeekPayload;
    try {
      payload = (await response.json()) as DeepSeekPayload;
    } catch (error) {
      if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
        throw timeoutError(error);
      }
      throw invalidResponseError(error);
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (!content) throw invalidResponseError();

    let parsed: T;
    try {
      parsed = parseContent(content);
    } catch (error) {
      throw invalidResponseError(error);
    }

    safeLog("info", {
      event: "completed",
      entrypoint,
      requestId,
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      model,
      promptLength: prompt.length,
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      finishReason: choice?.finish_reason ?? null,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens
    });

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestDeepSeekJson<T>(
  options: RequestDeepSeekJsonOptions<T>
): Promise<DeepSeekJsonResult<T>> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new DeepSeekError({
      code: "AI_UNAVAILABLE",
      message: "服务器未配置 DeepSeek API Key。",
      status: 503,
      retryable: false
    });
  }

  const model = options.model?.trim() || getDeepSeekModel();
  const timeoutMs = positiveIntegerFromEnv(
    "DEEPSEEK_ATTEMPT_TIMEOUT_MS",
    DEFAULT_ATTEMPT_TIMEOUT_MS
  );
  const maxTokens = positiveIntegerFromEnv("DEEPSEEK_MAX_TOKENS", DEFAULT_MAX_TOKENS);
  const requestId = randomUUID();
  let lastError: DeepSeekError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const parsed = await runAttempt({
        ...options,
        apiKey,
        model,
        maxTokens,
        timeoutMs,
        requestId,
        attempt
      });
      return { parsed, modelName: model, requestId };
    } catch (error) {
      const normalized = normalizeAttemptError(error, false);
      lastError = normalized;
      safeLog("warn", {
        event: "failed",
        entrypoint: options.entrypoint,
        requestId,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        model,
        promptLength: options.prompt.length,
        httpStatus: normalized.upstreamStatus,
        elapsedMs: Date.now() - startedAt,
        code: normalized.code,
        retryable: normalized.retryable,
        willRetry: normalized.retryable && attempt < MAX_ATTEMPTS
      });

      if (!normalized.retryable || attempt === MAX_ATTEMPTS) throw normalized;
    }
  }

  throw lastError ?? networkError(new Error("DeepSeek request ended unexpectedly"));
}
