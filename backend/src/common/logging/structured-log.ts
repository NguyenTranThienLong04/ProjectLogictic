const SENSITIVE_FIELD = /(authorization|cookie|credential|password|secret|token)/i;
const URL_CREDENTIALS = /([a-z][a-z\d+.-]*:\/\/[^\s/:@]+:)[^\s@/]+(@)/gi;
const BEARER_TOKEN = /(bearer\s+)[a-z\d._~+/-]+=*/gi;
const SENSITIVE_ASSIGNMENT =
  /((?:authorization|cookie|credential|password|secret|token)\s*[=:]\s*)[^\s,;]+/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_CREDENTIALS, '$1[REDACTED]$2')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT, '$1[REDACTED]');
}

function redact(value: unknown, fieldName?: string): unknown {
  if (fieldName && SENSITIVE_FIELD.test(fieldName)) return '[REDACTED]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, key)]));
  }
  return value;
}

export function structuredLog(event: string, fields: Record<string, unknown>): string {
  return JSON.stringify(redact({ event, ...fields }));
}
