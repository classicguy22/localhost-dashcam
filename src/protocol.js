export const channel = 'localhost-dashcam';
export const windowMs = 60_000;
export const replayBudget = 1_500_000;
export const maxFileBytes = 8_000_000;

export function supportedOrigin(input) {
  try {
    const url = new URL(input);
    if (['http:', 'https:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
  } catch {
    // An unavailable or non-web tab URL cannot be armed.
  }
  return null;
}

export function localPath(input) {
  try {
    const url = new URL(input, location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin + url.pathname;
    }
  } catch {
    // Unsupported URL or input.
  }
  return '(unavailable URL)';
}
