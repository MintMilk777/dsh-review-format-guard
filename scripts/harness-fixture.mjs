import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

export const allow = '{"risk":"low","decision":"allow"}';
export const deny = '{"risk":"high","decision":"deny","reason":"Explicit refusal"}';
export function chunks(text = allow) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}
export async function* stream(items) { yield* items; }
export async function collect(iterable) { const out = []; for await (const item of iterable) out.push(item); return out; }

export function harness(responses, config = {}) {
  let listeners = [];
  const cleanups = [];
  const calls = [];
  const logs = [];
  const ctx = {
    logger: { info: line => logs.push(line), warn: line => logs.push(line) },
    effect(factory) { cleanups.push(factory()); },
    on(event, handler, options) {
      assert.equal(event, 'llm/stream');
      options?.prepend ? listeners.unshift(handler) : listeners.push(handler);
      cleanups.push(() => { listeners = listeners.filter(listener => listener !== handler); });
    },
    llm: { stream(request) {
      const chain = [...listeners];
      const terminal = () => {
        const index = calls.push(request) - 1;
        const response = responses[Math.min(index, responses.length - 1)];
        return typeof response === 'function' ? response(request) : stream(response);
      };
      const next = () => (chain.shift() ?? terminal)(request, next);
      return next();
    } },
  };
  apply(ctx, { retryDelayMs: 0, ...config });
  return { ctx, calls, logs, dispose() { for (const cleanup of cleanups.reverse()) cleanup?.(); } };
}
