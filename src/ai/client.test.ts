import { describe, expect, it, vi } from 'vitest';
import { AiError, readEvents, streamMessage } from './client';

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

const collect = async (chunks: string[]) => {
  const out = [];
  for await (const event of readEvents(stream(chunks))) out.push(event);
  return out;
};

const sse = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

describe('reading the event stream', () => {
  it('reads events that arrive split across chunks', async () => {
    const whole = sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello' } });
    const events = await collect([whole.slice(0, 20), whole.slice(20), 'data: [DONE]\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'content_block_delta' });
  });

  it('skips a payload it cannot parse rather than giving up', async () => {
    const events = await collect(['data: {oops\n\n', sse('message_stop', {})]);
    expect(events.map((e) => e.type)).toEqual(['message_stop']);
  });
});

describe('streaming a reply', () => {
  const answer = [
    sse('content_block_start', { index: 0, content_block: { type: 'text' } }),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Two of your ' } }),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'habits slipped.' } }),
    sse('content_block_stop', { index: 0 }),
    sse('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'propose_changes' } }),
    sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"changes":[{"kind":' } }),
    sse('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"new_habit","title":"Walk"}]}' } }),
    sse('content_block_stop', { index: 1 }),
    sse('message_delta', { delta: { stop_reason: 'tool_use' } }),
  ].join('');

  it('collects the text as it arrives and the tool call at the end', async () => {
    const chunks: string[] = [];
    vi.stubGlobal('fetch', async () => new Response(stream([answer]), { status: 200 }));
    const result = await streamMessage({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'hi' }], onText: (c) => chunks.push(c) });
    expect(chunks).toEqual(['Two of your ', 'habits slipped.']);
    expect(result.text).toBe('Two of your habits slipped.');
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'propose_changes', input: { changes: [{ kind: 'new_habit', title: 'Walk' }] } }]);
    vi.unstubAllGlobals();
  });

  it('turns a rejected key into something worth reading', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }));
    await expect(streamMessage({ apiKey: 'sk-ant-bad', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(AiError);
    await expect(streamMessage({ apiKey: 'sk-ant-bad', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/rejected the API key/);
    vi.unstubAllGlobals();
  });

  it('sends the header that lets a browser call the API at all', async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(stream([sse('message_delta', { delta: { stop_reason: 'end_turn' } })]), { status: 200 });
    });
    await streamMessage({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    const headers = seen?.headers as Record<string, string>;
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(JSON.parse(String(seen?.body)).stream).toBe(true);
    vi.unstubAllGlobals();
  });
});
