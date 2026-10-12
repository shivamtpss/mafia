import { Injectable, Logger } from '@nestjs/common';

export interface OllamaGenerateOptions {
  /** Hard timeout in ms; the request is aborted past this. */
  timeoutMs: number;
  /** Ask Ollama to emit strict JSON. */
  json?: boolean;
  /** Cap generated tokens to bound latency. */
  maxTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Optional system prompt. */
  system?: string;
}

export interface OllamaResult {
  ok: boolean;
  /** Raw model text (JSON string when json=true). Empty on failure. */
  text: string;
  /** Reason for failure, for logging/debug only. */
  error?: string;
}

/**
 * Thin, defensive wrapper over the local Ollama HTTP API. Every call is bounded
 * by an AbortController timeout and never throws: callers always get an
 * OllamaResult and can fall back deterministically. The browser never talks to
 * this; it is server-side only.
 */
@Injectable()
export class OllamaClient {
  private readonly logger = new Logger(OllamaClient.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL ?? 'llama3.2';
  }

  get configuredModel(): string {
    return this.model;
  }

  /** Quick availability probe (bounded). Used to skip generation when down. */
  async isAvailable(timeoutMs = 1500): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate text from a prompt. Bounded by timeout; returns ok:false on any
   * error (network, abort, non-200) rather than throwing.
   */
  async generate(
    prompt: string,
    opts: OllamaGenerateOptions,
  ): Promise<OllamaResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          prompt,
          system: opts.system,
          stream: false,
          format: opts.json ? 'json' : undefined,
          options: {
            temperature: opts.temperature ?? 0.8,
            num_predict: opts.maxTokens ?? 256,
          },
        }),
      });
      if (!res.ok) {
        return { ok: false, text: '', error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { response?: string };
      const text = (data.response ?? '').trim();
      return { ok: text.length > 0, text };
    } catch (err) {
      const reason =
        (err as Error)?.name === 'AbortError'
          ? `timeout after ${Date.now() - started}ms`
          : (err as Error)?.message ?? 'unknown error';
      this.logger.debug(`Ollama generate failed: ${reason}`);
      return { ok: false, text: '', error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
