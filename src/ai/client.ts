/**
 * Talking to Claude straight from the browser, with your own API key.
 *
 * Anthropic allows this when the request carries `anthropic-dangerous-direct-browser-access`.
 * Nothing sits in between: the request goes from this device to api.anthropic.com, and the key
 * never leaves the device except in that header.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: string | null;
}

export interface StreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with each new piece of the reply as it arrives. */
  onText?: (chunk: string) => void;
}

/** A failed request, with a message worth showing to a person. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function explain(status: number, body: string): string {
  const detail = (() => {
    try {
      return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      return '';
    }
  })();
  if (status === 401) return 'Anthropic rejected the API key. Check it in Coach → Settings.';
  if (status === 403) return `That key isn’t allowed to use this model. ${detail}`.trim();
  if (status === 404) return 'That model name was not found. Pick another model in Coach → Settings.';
  if (status === 429) return 'Rate limit reached. Wait a moment and try again.';
  if (status === 400 && /credit balance|billing/i.test(detail)) return 'Your Anthropic account is out of credit. Top it up in the Anthropic Console.';
  if (status >= 500) return 'Anthropic’s API is having trouble. Try again shortly.';
  return detail || `The request failed (${status}).`;
}

/**
 * Sends a conversation and streams the reply.
 * Resolves with the whole reply plus any tool calls once the stream ends.
 */
export async function streamMessage(options: StreamOptions): Promise<StreamResult> {
  const { apiKey, model, system, messages, tools, maxTokens = 2048, signal, onText } = options;
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
    });
  } catch (e) {
    if (signal?.aborted) throw new AiError('Stopped.');
    throw new AiError(`Couldn’t reach Anthropic: ${e instanceof Error ? e.message : 'network error'}. Check your connection.`);
  }

  if (!res.ok || !res.body) throw new AiError(explain(res.status, await res.text().catch(() => '')), res.status);

  const result: StreamResult = { text: '', toolCalls: [], stopReason: null };
  // Tool arguments arrive as JSON in pieces, one block at a time.
  const partials = new Map<number, { id: string; name: string; json: string }>();

  for await (const event of readEvents(res.body, signal)) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block as { type: string; id?: string; name?: string } | undefined;
        if (block?.type === 'tool_use') partials.set(event.index as number, { id: block.id ?? '', name: block.name ?? '', json: '' });
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta as { type: string; text?: string; partial_json?: string };
        if (delta.type === 'text_delta' && delta.text) {
          result.text += delta.text;
          onText?.(delta.text);
        } else if (delta.type === 'input_json_delta') {
          const partial = partials.get(event.index as number);
          if (partial) partial.json += delta.partial_json ?? '';
        }
        break;
      }
      case 'content_block_stop': {
        const partial = partials.get(event.index as number);
        if (partial) {
          partials.delete(event.index as number);
          try {
            result.toolCalls.push({ id: partial.id, name: partial.name, input: JSON.parse(partial.json || '{}') });
          } catch {
            /* an unfinished tool call is dropped rather than half-applied */
          }
        }
        break;
      }
      case 'message_delta': {
        const delta = event.delta as { stop_reason?: string } | undefined;
        if (delta?.stop_reason) result.stopReason = delta.stop_reason;
        break;
      }
      case 'error': {
        const error = event.error as { message?: string } | undefined;
        throw new AiError(error?.message || 'The reply was interrupted.');
      }
    }
  }
  return result;
}

type SseEvent = Record<string, unknown> & { type: string };

/** Reads an `event:`/`data:` stream and yields each parsed JSON payload. */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Stopping cancels the reader, so a stream that never ends doesn't hold the turn open.
  const onAbort = () => void reader.cancel().catch(() => undefined);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Events are separated by a blank line; a chunk may hold several, or half of one.
      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            yield JSON.parse(data) as SseEvent;
          } catch {
            /* ignore a payload we can't read rather than ending the stream */
          }
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
