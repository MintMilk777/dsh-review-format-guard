import { createHash } from 'node:crypto';

// A fingerprint, not a copy or replacement, of the installed 0.2.1-rc.3 policy.
export const SUPPORTED_POLICY_HASH = '1ee45271ed0609302c859061c0d9830903aaec51db872e97da50d2da1c388ec0';

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
  if (createHash('sha256').update(options.system).digest('hex') !== SUPPORTED_POLICY_HASH) return false;
  if (options.tools !== undefined && (!Array.isArray(options.tools) || options.tools.length !== 0)) return false;
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
 * Repeat the exact, trusted native policy after the complete data envelope.
 * Some gateways ignore or replace system messages and otherwise continue the
 * transcript embedded in FILTERED_HISTORY. No logged fact or policy is removed.
 */
export function reinforceReviewRequest(request) {
  if (!nativeReviewRequest(request)) throw new TypeError('Only verified native auxiliary reviews may be reinforced.');
  const message = request.messages[0];
  const block = message.content[0];
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
