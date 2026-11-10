# Localhost Dashcam

**Save the last minute of a broken local web session.** Record a tab, trigger a bug, and open a capsule with page replay, clicks, console errors, and failed requests on one timeline.

![Capsule viewer showing the demo checkout replay next to an HTTP 503 and console error](docs/checkout-capsule.png)

## Try it

You need Node.js 18+ and Chrome or another Chromium browser that supports Manifest V3 (Chrome 120+).

```sh
npm ci
npm run build
npm run demo
```

1. In Chrome, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select this repo's `dist` directory.
2. Open the [demo checkout](http://127.0.0.1:4173). Open the Dashcam extension and click **Start recording this tab**.
3. Click **Add one**, then **Place order**. The demo intentionally returns HTTP 503.
4. Open Dashcam again and click **Save last 60 seconds**. Select the failed POST in the timeline, scrub the replay, or download the capsule.

You can also choose **Open capsule viewer → Try sample** from the extension to explore a bundled recording without running the demo server. To share a capture, uncheck any timeline rows you want to omit and download it. Recipients can load the extension and open the JSON file in its viewer.

## Capture scope

- Recording starts on demand and supports top-level pages on `localhost` and `127.0.0.1`. A reload or full navigation ends the recording. Same-document route changes are tracked. Add `data-dashcam-label="Place order"` to give a click a readable timeline label.
- The page recorder holds up to 60 seconds of timeline events, capped at 400 rows. A replay may include a few seconds of lead-in for its starting DOM snapshot. Large or busy pages can get a shorter replay due to the buffer limit.
- Network events cover failed page `fetch` and XHR calls made through the instrumented functions. They include method, origin, and path. Console capture includes the first argument of `console.error`, uncaught errors, and unhandled rejections.
- Playback reconstructs the page DOM from rrweb events. Remote resources, canvas, and embedded frames can appear differently in the replay.
- Captures stay in browser memory until exported. Query strings and fragments are omitted from timeline URLs. Replay is off by default in exports and can include visible text, DOM attributes, and asset URLs. Form values are masked where rrweb supports masking. Mark sensitive DOM sections with `data-dashcam-private` and review a capsule before sharing it.

The extension uses [rrweb](https://github.com/rrweb-io/rrweb) for DOM recording and replay, and [esbuild](https://esbuild.github.io/) for bundling.

MIT
