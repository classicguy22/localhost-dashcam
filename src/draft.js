import { supportedOrigin } from './protocol.js';

function route(detail) {
  if (!supportedOrigin(detail)) return null;
  return new URL(detail).pathname;
}

const comment = value => String(value).replace(/[\r\n\u2028\u2029]+/g, ' ');

export function playwrightDraft(rows) {
  const start = rows.map(row => route(row.detail)).find(Boolean) ?? '/';
  const lines = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('reproduce the Dashcam capture', async ({ page }) => {",
    "  test.fixme(true, 'Review the steps and add assertions before enabling this draft.');",
    "  const origin = new URL(process.env.DASHCAM_BASE_URL ?? 'http://localhost:3000').origin;",
    '  await page.goto(origin + ' + JSON.stringify(start) + ');'
  ];
  for (const row of rows) {
    if (row.kind === 'click') {
      lines.push('  // ' + comment(row.message));
      if (typeof row.selector === 'string' && row.selector && row.selector.length <= 250) {
        lines.push('  await page.locator(' + JSON.stringify(row.selector) + ').click();');
      } else {
        lines.push('  // TODO: Replace this step with a stable locator.');
      }
    }
    if (row.kind === 'navigation' && row.message === 'Page reloaded') lines.push('  await page.reload();');
    if (row.kind === 'navigation' && route(row.detail) && route(row.detail) !== start) {
      lines.push('  // TODO: Verify the app navigates to ' + comment(route(row.detail)));
    }
    if (row.kind === 'error' || row.kind === 'network') {
      lines.push('  // Observed: ' + comment(row.message));
    }
  }
  lines.push('', '  // TODO: Assert the expected behavior with expect(...).', '});', '');
  return lines.join('\n');
}
