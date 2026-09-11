function httpUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value, window.location.origin);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  if (
    import.meta.env.PROD &&
    window.location.protocol === 'https:' &&
    parsed.protocol !== 'https:'
  ) {
    throw new Error(`${name} must use HTTPS when the production frontend uses HTTPS`);
  }
  return parsed.toString().replace(/\/$/, '');
}

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();
const configuredDocsUrl = import.meta.env.VITE_API_DOCS_URL?.trim();

export const API_BASE_URL = httpUrl(configuredApiUrl || '/api/v1', 'VITE_API_URL');
export const SOCKET_BASE_URL = configuredSocketUrl
  ? httpUrl(configuredSocketUrl, 'VITE_SOCKET_URL')
  : new URL(API_BASE_URL).origin;
export const API_DOCS_URL = configuredDocsUrl
  ? httpUrl(configuredDocsUrl, 'VITE_API_DOCS_URL')
  : undefined;
