import { ReviewFormatError } from './protocol.js';

// Only these fixed classifications may reach logs or user-visible diagnostics.
// Never interpolate a provider's arbitrary code, message, URL or cause text.
const upstream = new Map([
  ['UNSUPPORTED_REASONING_EFFORT', ['REVIEW_UPSTREAM_UNSUPPORTED_REASONING_EFFORT', 'The current review channel does not support the requested reasoning effort. Adjust the call settings before retrying.', false]],
  ['CONTEXT_WINDOW_EXCEEDED', ['REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED', 'Review input exceeds the provider context window. Reduce the input before retrying.', false]],
  ['QUOTA', ['REVIEW_UPSTREAM_QUOTA', 'Review provider quota is exhausted.', false]],
  ['ACCOUNT_QUOTA', ['REVIEW_UPSTREAM_ACCOUNT_QUOTA', 'Review provider account quota is exhausted.', false]],
  ['AUTH', ['REVIEW_UPSTREAM_AUTH', 'Review provider authentication failed.', false]],
  ['INVALID_CREDENTIAL', ['REVIEW_UPSTREAM_AUTH', 'Review provider authentication failed.', false]],
  ['MISSING_CREDENTIAL', ['REVIEW_UPSTREAM_AUTH', 'Review provider authentication failed.', false]],
  ['INVALID_REQUEST', ['REVIEW_UPSTREAM_INVALID_REQUEST', 'Review provider rejected the request as invalid.', false]],
  ['RATE_LIMIT', ['REVIEW_UPSTREAM_RATE_LIMIT', 'Review provider temporarily rate-limited the request.', true]],
  ['TIMEOUT', ['REVIEW_UPSTREAM_TIMEOUT', 'Review provider reported a timeout.', true]],
  ['SERVER', ['REVIEW_UPSTREAM_SERVER', 'Review provider reported a temporary server failure.', true]],
  ['TRANSPORT', ['REVIEW_UPSTREAM_TRANSPORT', 'Review provider reported a transport failure.', true]],
  ['NETWORK', ['REVIEW_UPSTREAM_TRANSPORT', 'Review provider reported a network failure.', true]],
  ['NETWORK_ERROR', ['REVIEW_UPSTREAM_TRANSPORT', 'Review provider reported a network failure.', true]],
  ['CONNECTION_ERROR', ['REVIEW_UPSTREAM_TRANSPORT', 'Review provider reported a connection failure.', true]],
  ['EMPTY_RESPONSE', ['REVIEW_UPSTREAM_EMPTY_RESPONSE', 'Review provider returned an empty response.', true]],
]);

export function cancellation() {
  return new ReviewFormatError('REVIEW_CANCELLED', 'Review was cancelled.', false);
}

export function upstreamFailure(reason) {
  if (reason?.kind === 'aborted') return cancellation();
  const known = upstream.get(reason?.failure?.code);
  return known ? new ReviewFormatError(...known)
    : new ReviewFormatError('REVIEW_UPSTREAM_FAILURE', 'Review provider failed with an unclassified error.', false);
}

// Node socket/DNS errors and Undici connection/read errors only. In particular,
// a generic TypeError("fetch failed") or message containing "network" is not evidence.
const connectionCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
const cancelCodes = new Set(['ABORT_ERR', 'ERR_CANCELED', 'ERR_CANCELLED', 'UND_ERR_ABORTED']);
const internalCodes = new Set([
  'REVIEW_TIMEOUT', 'REVIEW_CANCELLED', 'REVIEW_STREAM_INVALID', 'REVIEW_SIZE_LIMIT',
  'REVIEW_JSON_INVALID', 'REVIEW_SCHEMA_INVALID', 'REVIEW_DUPLICATE_KEYS', 'REVIEW_TEXT_MISSING',
  'REVIEW_UPSTREAM_FAILURE', 'REVIEW_CONNECTION_FAILURE', 'REVIEW_STREAM_FAILURE',
  ...[...upstream.values()].map(([code]) => code),
]);

// Only exact local validator descriptions may leave the plugin. This map is
// deliberately not parsed from provider-controlled codes or message fragments.
const streamReasons = new Map([
  ['Invalid review block index.', 'block-index'],
  ['Review response contains a non-text action block.', 'action-block'],
  ['Review block type changed.', 'block-type-change'],
  ['Invalid review stream item.', 'invalid-item'],
  ['Review emitted data after its terminal finish.', 'after-finish'],
  ['Review has an invalid terminal outcome.', 'invalid-finish'],
  ['Review did not end with a normal stop.', 'non-stop-finish'],
  ['Review ended at its output token limit.', 'output-limit'],
  ['Review ended by requesting tool calls.', 'tool-calls-finish'],
  ['Review block was started more than once or out of order.', 'block-start-order'],
  ['Review has invalid or late text deltas.', 'invalid-delta'],
  ['Review block ended more than once or has invalid text.', 'invalid-block-end'],
  ['Review deltas disagree with the completed block.', 'snapshot-conflict'],
  ['Review response contains an unsupported stream item.', 'unsupported-item'],
  ['Review stream ended without a terminal outcome.', 'missing-finish'],
  ['Review contains no meaningful text or reasoning.', 'empty-content'],
  ['Review has no final text conclusion.', 'missing-conclusion'],
  ['Review contains multiple text conclusions or text before reasoning.', 'block-order'],
  ['Review provider did not return an async stream.', 'missing-async-stream'],
  ['Review returned an invalid stream item.', 'unserializable-item'],
]);

export function streamFailure(error) {
  if (error instanceof ReviewFormatError && internalCodes.has(error.code)) return error;
  const seen = new Set();
  let connection = false;
  let current = error;
  // Bounded and cycle-safe; cancellation anywhere in the inspected cause chain
  // wins over a network code on an enclosing error.
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    let code, name, cause;
    try { ({ code, name, cause } = current); } catch { connection = false; break; }
    if (name === 'AbortError' || cancelCodes.has(code)) return cancellation();
    if (connectionCodes.has(code)) connection = true;
    current = cause;
    // Do not retry an incompletely inspected chain: a deeper cause may cancel.
    if (depth === 7 && current) connection = false;
  }
  return connection
    ? new ReviewFormatError('REVIEW_CONNECTION_FAILURE', 'Review connection failed before validation.', true)
    : new ReviewFormatError('REVIEW_STREAM_FAILURE', 'Review stream failed before validation.', false);
}

// Final diagnostics use fixed descriptions even if an adapter throws an instance
// of our exported error class with a known code but an arbitrary message.
export function safeFailure(error) {
  const known = [...upstream.values()].find(([code]) => code === error.code);
  const fixed = {
    REVIEW_TIMEOUT: 'Review attempt exceeded a waiting deadline.',
    REVIEW_CANCELLED: 'Review was cancelled.',
    REVIEW_STREAM_INVALID: 'Review stream structure or completion was invalid.',
    REVIEW_SIZE_LIMIT: 'Review exceeded a resource budget.',
    REVIEW_JSON_INVALID: 'Review did not contain valid JSON.',
    REVIEW_SCHEMA_INVALID: 'Review did not match the required decision schema.',
    REVIEW_DUPLICATE_KEYS: 'Review contained duplicate JSON keys.',
    REVIEW_TEXT_MISSING: 'Review conclusion was missing.',
    REVIEW_UPSTREAM_FAILURE: 'Review provider failed with an unclassified error.',
    REVIEW_CONNECTION_FAILURE: 'Review connection failed before validation.',
    REVIEW_STREAM_FAILURE: 'Review stream failed before validation.',
  };
  const shape = /shape=(empty|tool-markup|code-fence|json-fragment-or-multiple-objects|json-array|prose-or-other-text)(?=[,)])/.exec(error.message)?.[1];
  const detail = error.code === 'REVIEW_JSON_INVALID' && shape ? ` (shape=${shape})` : '';
  const budget = /^Review exceeded its (stream item|single item byte|content byte|replay state byte|retained byte|buffered item|retained memory) budget\.$/.exec(error.message)?.[1];
  const timeouts = new Set(['Review attempt exceeded its total deadline.', 'Review timed out waiting for first meaningful text or reasoning content.', 'Review timed out without new meaningful text or reasoning content.']);
  const streamReason = error.code === 'REVIEW_STREAM_INVALID' ? streamReasons.get(error.message) : undefined;
  const precise = streamReason ? error.message
    : error.code === 'REVIEW_SIZE_LIMIT' && budget ? `Review exceeded its ${budget} budget.`
    : error.code === 'REVIEW_TIMEOUT' && timeouts.has(error.message) ? error.message : undefined;
  const result = new ReviewFormatError(error.code, (precise ?? known?.[1] ?? fixed[error.code] ?? 'Review failed validation.') + detail,
    error.retryable);
  const stage = error.code === 'REVIEW_TIMEOUT' && timeouts.has(error.message)
    ? error.message.includes('total') ? 'total' : error.message.includes('first') ? 'first-content' : 'idle'
    : error.code === 'REVIEW_SIZE_LIMIT' ? budget?.replaceAll(' ', '-') : streamReason;
  result.diagnostic = stage ? `${result.code}(${stage})` : result.code;
  return result;
}
