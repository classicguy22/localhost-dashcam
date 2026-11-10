export const channel = 'localhost-dashcam';
export const windowMs = 60_000;
export const replayBudget = 1_500_000;
export const maxFileBytes = 8_000_000;

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
