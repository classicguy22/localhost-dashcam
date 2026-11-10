import { channel, localPath } from './protocol.js';

let stop;

function errorMessage(value) {
  if (typeof value === 'string') return value.slice(0, 300);
  if (value instanceof Error) return String(value.message).slice(0, 300);
  return '(non-text value)';
}

function requestDetails(input, method) {
  return String(method || 'GET').slice(0, 16) + ' ' + localPath(input);
}

function previewAllowed(url, contentType) {
  return url.startsWith(location.origin + '/') && /^(text\/|application\/(?:json|problem\+json)\b)/i.test(contentType);
}

async function readPreview(response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let remaining = 2048;
  let text = '';
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      remaining -= value.length;
    }
    return text + decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
}

function start(bodies) {
  let enabled = true;
  const requests = new WeakMap();
  const undo = [];

  function report(kind, message, detail = '', fields) {
    if (enabled) window.postMessage({ channel, kind, message, detail, ...fields }, location.origin);
  }

  function reportRequest(message, status, detail, started, requestId) {
    report('network', message, detail, {
      network: { durationMs: Math.round(performance.now() - started), status },
      requestId
    });
  }

  function patch(target, key, track) {
    const previous = target[key];
    const wrapper = function (...args) {
      if (!enabled) return Reflect.apply(previous, this, args);
      return track.call(this, previous, args);
    };
    try {
      target[key] = wrapper;
      undo.push(() => {
        if (target[key] === wrapper) target[key] = previous;
      });
    } catch {
      // Some apps make their instrumentation non-writable.
    }
  }

  patch(window, 'fetch', function (previous, args) {
    const started = performance.now();
    const result = Reflect.apply(previous, this, args);
    const [input, options] = args;
    let detail;
    try {
      const request = input instanceof Request;
      detail = requestDetails(request ? input.url : input, options?.method || (request ? input.method : 'GET'));
    } catch {
      return result;
    }
    return result.then(response => {
      if (response.status >= 400 && enabled) {
        const requestId = crypto.randomUUID();
        reportRequest('HTTP ' + response.status, response.status, detail, started, requestId);
        if (bodies && previewAllowed(response.url, response.headers.get('content-type') ?? '')) {
          readPreview(response).then(preview => report('response', '', '', { requestId, preview })).catch(() => {});
        }
      }
      return response;
    }, error => {
      if (error?.name !== 'AbortError') reportRequest('Request failed', 0, detail, started);
      throw error;
    });
  });

  patch(XMLHttpRequest.prototype, 'open', function (previous, args) {
    const result = Reflect.apply(previous, this, args);
    const [method, url] = args;
    requests.set(this, requestDetails(url, method));
    return result;
  });

  patch(XMLHttpRequest.prototype, 'send', function (previous, args) {
    const detail = requests.get(this);
    if (!detail) return Reflect.apply(previous, this, args);
    const started = performance.now();
    const listeners = {
      load: () => {
        if (!enabled || this.status < 400) return;
        const requestId = crypto.randomUUID();
        reportRequest('HTTP ' + this.status, this.status, detail, started, requestId);
        if (bodies && ['', 'text'].includes(this.responseType) &&
            previewAllowed(this.responseURL, this.getResponseHeader('content-type') ?? '')) {
          report('response', '', '', { requestId, preview: this.responseText.slice(0, 2048) });
        }
      },
      error: () => reportRequest('Request failed', 0, detail, started),
      timeout: () => reportRequest('Request timed out', 0, detail, started),
      loadend: () => cleanup()
    };
    const cleanup = () => {
      for (const [name, handler] of Object.entries(listeners)) this.removeEventListener(name, handler);
    };
    for (const [name, handler] of Object.entries(listeners)) this.addEventListener(name, handler);
    try {
      return Reflect.apply(previous, this, args);
    } catch (error) {
      cleanup();
      throw error;
    }
  });

  patch(console, 'error', function (previous, args) {
    const result = Reflect.apply(previous, this, args);
    report('error', errorMessage(args[0]));
    return result;
  });

  const onError = event => report('error', errorMessage(event.message));
  const onRejection = event => report('error', errorMessage(event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    enabled = false;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    for (const restore of undo) {
      try {
        restore();
      } catch {
        // The inactive wrapper still delegates to the original.
      }
    }
  };
}

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
  if (event.data.control === 'start' && !stop) stop = start(event.data.bodies === true);
  if (event.data.control === 'stop' && stop) {
    stop();
    stop = undefined;
  }
});
