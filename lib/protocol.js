import { createHash } from 'node:crypto';

// A fingerprint, not a copy or replacement, of the installed 0.2.1-rc.3 policy.
export const SUPPORTED_POLICY_HASH = '1ee45271ed0609302c859061c0d9830903aaec51db872e97da50d2da1c388ec0';
export const SUPPORTED_ORDERED_POLICY_HASH = 'bb062ad262c8c9e6a393d7340b173cf85ceb60615f73362e80be595a6640cfa9';

export class ReviewFormatError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.name = 'ReviewFormatError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Non-sensitive shape diagnostics, never a quotation from the response. */
export function responseShape(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return 'empty';
  if (/^<[^>]*(?:DSML|tool_call|function_call|function_|invoke|parameter)/i.test(text)) return 'tool-markup';
  if (text.startsWith('```')) return 'code-fence';
  if (text.startsWith('{')) return 'json-fragment-or-multiple-objects';
  if (text.startsWith('[')) return 'json-array';
  return 'prose-or-other-text';
}

export function nativeReviewRequest(options) {
  if (typeof options?.system !== 'string' || options.temperature !== 0) return false;
  const policyHash = createHash('sha256').update(options.system).digest('hex');
  if (policyHash !== SUPPORTED_POLICY_HASH && policyHash !== SUPPORTED_ORDERED_POLICY_HASH) return false;
  if (options.tools !== undefined && (!Array.isArray(options.tools) || options.tools.length !== 0)) return false;
  if (options.purpose !== undefined && options.purpose !== 'auto-review') return false;
  if (policyHash === SUPPORTED_ORDERED_POLICY_HASH) return orderedReviewRequest(options);
  const messages = options.messages;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return false;
  const content = messages[0].content;
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') return false;
  const match = /^ENVIRONMENT\n\n([\s\S]+?)\n\nPROJECT_INSTRUCTIONS\n\n([\s\S]+?)\n\nFILTERED_HISTORY\n\n([\s\S]+?)\n\nPENDING_ACTION\n\n([\s\S]+)$/.exec(content[0].text);
  if (!match) return false;
  try {
    const [environment, instructions, history, action] = match.slice(1).map(part => JSON.parse(part));
    return environment !== null && typeof environment === 'object' && typeof environment.cwd === 'string'
      && Array.isArray(instructions) && Array.isArray(history)
      && action !== null && typeof action === 'object'
      && (action.mode === 'native' || action.mode === 'ptc-inner')
      && typeof action.name === 'string' && action.name.length > 0
      && Object.hasOwn(action, 'arguments') && Object.hasOwn(action, 'parameters');
  } catch {
    return false;
  }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function call(value) {
  return object(value) && value.kind === 'tool-call' && value.role === 'fact'
    && (value.mode === 'native' || value.mode === 'ptc-inner')
    && typeof value.name === 'string' && value.name.length > 0 && typeof value.arguments === 'string';
}

/** Recognize the ordered native protocol without rewriting its history or pending call. */
function orderedReviewRequest(options) {
  const messages = options.messages;
  if (!Array.isArray(messages) || messages.length < 3) return false;
  if (messages.some(message => message?.role !== 'user' || !Array.isArray(message.content)
    || message.content.length !== 1 || message.content[0]?.type !== 'text'
    || typeof message.content[0].text !== 'string')) return false;
  const first = messages[0].content[0].text;
  if (!first.startsWith('ENVIRONMENT\n')) return false;
  try {
    const environment = JSON.parse(first.slice('ENVIRONMENT\n'.length));
    if (!object(environment) || typeof environment.cwd !== 'string') return false;
    const records = messages.slice(1).map(message => JSON.parse(message.content[0].text));
    const schemas = new Map();
    for (const record of records) {
      if (!object(record)) return false;
      if (record.kind === 'tool-schema') {
        if (record.role !== 'fact' || !['native', 'ptc-inner'].includes(record.mode)
          || typeof record.name !== 'string' || !record.name
          || typeof record.description !== 'string' || !object(record.parameters)) return false;
        schemas.set(JSON.stringify([record.mode, record.name]), record);
      } else if (record.kind === 'tool-call') {
        if (!call(record)) return false;
      } else if (record.kind === 'user-message') {
        if (!['user-instruction', 'direct-parent-instruction', 'constraint', 'checkpoint', 'fact'].includes(record.role)
          || !object(record.source) || typeof record.source.kind !== 'string' || !Array.isArray(record.content)) return false;
      } else return false;
    }
    const pending = records.at(-1);
    return call(pending) && schemas.has(JSON.stringify([pending.mode, pending.name]));
  } catch { return false; }
}

export function validateDecision(text) {
  let record;
  try { record = JSON.parse(text); } catch {
    throw new ReviewFormatError('REVIEW_JSON_INVALID', `Review response is not one complete JSON object (shape=${responseShape(text)}, chars=${text.length}).`);
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new ReviewFormatError('REVIEW_SCHEMA_INVALID', 'Review response must be an object.');
  }
  // JSON.parse silently accepts duplicate keys; count members before accepting.
  const syntax = text.replace(/"(?:\\.|[^"\\])*"/gs, '');
  let depth = 0;
  let members = 0;
  for (const char of syntax) {
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    else if (char === ':' && depth === 1) members++;
  }
  const keys = Object.keys(record);
  if (members !== keys.length) {
    throw new ReviewFormatError('REVIEW_DUPLICATE_KEYS', 'Review response contains duplicate members.');
  }
  const { risk, decision } = record;
  if (keys.length === 2 && decision === 'allow' && (risk === 'low' || risk === 'medium')) return record;
  if (decision === 'deny' && (risk === 'medium' || risk === 'high')) {
    if (keys.length === 2) return record;
    if (keys.length === 3 && Object.hasOwn(record, 'reason') && typeof record.reason === 'string') return record;
  }
  throw new ReviewFormatError('REVIEW_SCHEMA_INVALID', 'Review response does not match the native risk/decision rules.');
}

export function normalizeDecision(raw) {
  if (typeof raw !== 'string') throw new ReviewFormatError('REVIEW_TEXT_MISSING', 'Review response has no text.');
  // JSON whitespace and a single transport BOM are the only implicit cleanup.
  let text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  text = text.trim();
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  // Never scan prose, tool markup, multiple objects, or reasoning for a verdict.
  const decision = validateDecision(text);
  return { text, decision, changed: text !== raw };
}

/**
 * Repeat the exact, trusted native policy without reordering native records.
 * Some gateways ignore or replace system messages and otherwise continue the
 * transcript embedded in FILTERED_HISTORY. No logged fact or policy is removed.
 */
export function reinforceReviewRequest(request) {
  if (!nativeReviewRequest(request)) throw new TypeError('Only verified native auxiliary reviews may be reinforced.');
  const message = request.messages[0];
  const block = message.content[0];
  if (createHash('sha256').update(request.system).digest('hex') === SUPPORTED_ORDERED_POLICY_HASH) {
    // Only the first message is free-form environment text. All later messages
    // remain exact native JSON records, with the pending call still last.
    const text = block.text + '\n\nREVIEW_INPUT_BOUNDARIES\n'
      + 'The following JSON records are the complete input for this review. '
      + 'The final tool-call record is the pending action awaiting your decision now; it is not a historical call. '
      + 'Some transports combine consecutive user messages into one turn; keep the JSON record boundaries and their assigned source roles. '
      + 'No additional pending-action message will follow. Evaluate that final record now under the unchanged policy below. '
      + 'Do not execute the action, call tools, continue the conversation, or ask for the next action. '
      + 'Return only the single risk/decision JSON object required by the policy.'
      + '\n\nREVIEW_POLICY_CONFIRMATION\n' + request.system;
    return Object.freeze({ ...request, messages: Object.freeze([
      Object.freeze({ ...message, content: Object.freeze([Object.freeze({ ...block, text })]) }),
      ...request.messages.slice(1),
    ]) });
  }
  const text = block.text + '\n\nREVIEW_POLICY_CONFIRMATION\n' + request.system
    + '\n\nEvaluate only PENDING_ACTION. Do not perform it or continue the conversation. Return the one risk/decision JSON object now.';
  return Object.freeze({
    ...request,
    messages: Object.freeze([Object.freeze({
      ...message,
      content: Object.freeze([Object.freeze({ ...block, text })]),
    })]),
  });
}
