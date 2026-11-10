import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const text = name => readFile(new URL('../dist/' + name, import.meta.url), 'utf8');
const hash = code => "'sha256-" + createHash('sha256').update(code).digest('base64') + "'";
const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export async function buildStandaloneViewer() {
  const [viewer, replay, viewerCode, replayCode, ui, rrweb, replayStyle, mark, sample] = await Promise.all([
    'viewer.html', 'replay.html', 'viewer.js', 'replay.js', 'ui.css',
    'rrweb.css', 'replay.css', 'mark.svg', 'sample.capsule.json'
  ].map(text));

  if (/<\/script/i.test(viewerCode) || /<\/script/i.test(replayCode)) {
    throw new Error('A viewer bundle contains an inline script terminator.');
  }

  const policy = "default-src 'none'; script-src " + hash(viewerCode) + ' ' + hash(replayCode) +
    "; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src about:;" +
    " base-uri 'none'; form-action 'none'";
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">';

  const replayDocument = replay
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, csp)
    .replace('<link rel="stylesheet" href="rrweb.css">', () => '<style>' + rrweb + '</style>')
    .replace('<link rel="stylesheet" href="replay.css">', () => '<style>' + replayStyle + '</style>')
    .replace('<script src="replay.js"></script>', () => '<script>' + replayCode + '</script>');

  const markUri = 'data:image/svg+xml;base64,' + Buffer.from(mark).toString('base64');
  const styles = '<style>' + ui.replace('mark.svg', markUri) + '</style>';
  const sampleData = '<script id="embedded-sample" type="application/json">' +
    sample.replaceAll('<', '\\u003c') + '</script>';
  const page = viewer
    .replace('<link rel="stylesheet" href="ui.css">', () => csp + styles)
    .replace('src="replay.html"', () => 'srcdoc="' + escapeAttribute(replayDocument) + '"')
    .replace('<script src="viewer.js"></script>', () => sampleData + '<script>' + viewerCode + '</script>');

  await writeFile(new URL('../dist/capsule-viewer.html', import.meta.url), page);
}
