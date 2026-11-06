import { ReviewFormatError } from './protocol.js';

const bytes = value => Buffer.byteLength(JSON.stringify(value));
function limit(kind) {
  throw new ReviewFormatError('REVIEW_SIZE_LIMIT', `Review exceeded its ${kind} budget.`, true);
}

/** Separate raw work, retained representation, logical content and opaque state.
 * maxBytes still bounds serialized retained events (including full snapshots).
 * Only plain adjacent deltas merge; extra adapter metadata is never discarded.
 * Bounded 4096-code-unit runs avoid repeatedly serializing an entire large block.
 * Memory units conservatively charge strings, validator copies and object slots;
 * they are an accounting bound, not a claim about a JS engine's exact heap size.
 */
export function streamBudget(options) {
  const { maxBytes, maxChunks } = options;
  const maxContentBytes = options.maxContentBytes ?? maxBytes;
  const maxReplayBytes = options.maxReplayBytes ?? 262144;
  const maxBufferedChunks = options.maxBufferedChunks ?? 8192;
  const maxMemoryBytes = options.maxMemoryBytes ?? 4194304;
  let events = 0, retained = 0, content = 0, replay = 0;
  const blocks = new Map();
  const plainDelta = c => ['text-delta', 'reasoning-delta'].includes(c.type)
    && Object.keys(c).length === 3 && Object.hasOwn(c, 'index') && typeof c.text === 'string';
  return {
    event() { if (++events > maxChunks) limit('stream item'); },
    item(encoded) { if (Buffer.byteLength(encoded) > maxBytes) limit('single item byte'); },
    append(chunks, chunk, encoded) {
      const delta = ['text-delta', 'reasoning-delta'].includes(chunk.type);
      const text = delta ? chunk.text : chunk.type === 'block-end' ? chunk.block.text : undefined;
      if (text !== undefined) {
        const old = blocks.get(chunk.index) ?? { bytes: 0, deltas: false, high: false };
        // Keep surrogate pairs crossing delta boundaries equivalent to the snapshot.
        const paired = old.high && text.length > 0 && text.charCodeAt(0) >= 0xdc00 && text.charCodeAt(0) <= 0xdfff;
        const size = delta ? old.bytes + Buffer.byteLength(text) - (paired ? 2 : 0)
          : old.deltas ? old.bytes : Buffer.byteLength(text);
        content += size - old.bytes;
        blocks.set(chunk.index, { bytes: size, deltas: old.deltas || delta, high: text.length === 0 ? old.high : /[\uD800-\uDBFF]$/.test(text) });
        if (content > maxContentBytes) limit('content byte');
      }
      if (chunk.replayState !== undefined) {
        replay += bytes(chunk.replayState);
        if (replay > maxReplayBytes) limit('replay state byte');
      }
      const previous = chunks.at(-1);
      if (previous && plainDelta(previous) && plainDelta(chunk)
          && previous.type === chunk.type && previous.index === chunk.index
          && previous.text.length + chunk.text.length <= 4096) {
        const merged = { ...previous, text: previous.text + chunk.text };
        retained += bytes(merged) - bytes(previous);
        chunks[chunks.length - 1] = merged;
      } else {
        retained += Buffer.byteLength(encoded);
        chunks.push(chunk);
      }
      if (retained > maxBytes) limit('retained byte');
      if (chunks.length > maxBufferedChunks) limit('buffered item');
      if (8 * retained + 4 * content + 512 * (chunks.length + blocks.size) > maxMemoryBytes) limit('retained memory');
    },
  };
}
