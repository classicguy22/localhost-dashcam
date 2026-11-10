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

function start() {
  let enabled = true;
  const requests = new WeakMap();
  const undo = [];

  function report(kind, message, detail = '') {
    if (enabled) window.postMessage({ channel, kind, message, detail }, location.origin);
  }

  function reportStatus(status, detail) {
    if (status >= 400) report('network', 'HTTP ' + status, detail);
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
      reportStatus(response.status, detail);
      return response;
    }, error => {
      if (error?.name !== 'AbortError') report('network', 'Request failed', detail);
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
    const listeners = {
      load: () => reportStatus(this.status, detail),
      error: () => report('network', 'Request failed', detail),
      timeout: () => report('network', 'Request timed out', detail),
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
  if (event.data.control === 'start' && !stop) stop = start();
  if (event.data.control === 'stop' && stop) {
    stop();
    stop = undefined;
  }
});
