"""A pin click must not throw. Headless Chrome, local map, Leaflet from the network."""
import asyncio
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
import websockets

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

CLICK_JS = r"""
(async () => {
  const errors = window.__pageErrors || (window.__pageErrors = []);
  const map = window.__texmetricsMap;
  const state = window.__texmetricsMapState || {};
  if (!map) return { ok: false, why: "no map", errors, markers: 0 };
  const size = map.getSize();
  const layers = [];
  const walk = (layer) => {
    if (layer.eachLayer) layer.eachLayer(walk);
    if (!layer.getLatLng || !layer.getPopup || !layer.fire) return;
    if (!layer.getPopup()) return;
    const pt = map.latLngToContainerPoint(layer.getLatLng());
    if (pt.x < 8 || pt.y < 8 || pt.x > size.x - 8 || pt.y > size.y - 8) return;
    layers.push({
      layer,
      edge: Math.min(pt.x, pt.y, size.x - pt.x, size.y - pt.y),
      mid: Math.hypot(pt.x - size.x / 2, pt.y - size.y / 2),
    });
  };
  map.eachLayer(walk);
  if (!layers.length) return { ok: false, why: "no pins", errors, markers: 0 };
  const edge = layers.slice().sort((a, b) => a.edge - b.edge)[0];
  const middle = layers.slice().sort((a, b) => a.mid - b.mid)[0];
  function clickPin(item) {
    const before = errors.length;
    try {
      item.layer.fire("click");
    } catch (err) {
      errors.push({
        message: String(err && err.message || err),
        stack: String(err && err.stack || ""),
      });
    }
    return before;
  }
  function readPopup(item) {
    const popup = item.layer.getPopup && item.layer.getPopup();
    const el = popup && popup.getElement && popup.getElement();
    const text = el ? el.innerText : "";
    const link = el ? el.querySelector("a[href*='/rn/'], button[data-rn]") : null;
    return {
      text: text.slice(0, 400),
      rn: link ? (link.getAttribute("data-rn") || link.getAttribute("href") || "") : "",
    };
  }
  clickPin(edge);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const edgePopup = readPopup(edge);
  if (map.closePopup) map.closePopup();
  clickPin(middle);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const middlePopup = readPopup(middle);
  return {
    ok: true,
    markers: state.markersByKey ? state.markersByKey.size : 0,
    errors: errors.map((item) => ({
      message: String(item.message || ""),
      stack: String(item.stack || "").slice(0, 1200),
    })),
    edge: edgePopup,
    middle: middlePopup,
  };
})()
"""


class _Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return


def _free_port():
    import socket
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


async def _cdp(ws_url):
    async with websockets.connect(ws_url, max_size=32_000_000) as ws:
        seq = 0
        pending = {}

        async def reader():
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("id") in pending:
                    pending[msg["id"]].set_result(msg)

        task = asyncio.create_task(reader())

        async def call(method, params=None, timeout=60):
            nonlocal seq
            seq += 1
            ident = seq
            fut = asyncio.get_running_loop().create_future()
            pending[ident] = fut
            await ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            try:
                return await asyncio.wait_for(fut, timeout)
            finally:
                pending.pop(ident, None)

        try:
            yield call
        finally:
            task.cancel()


def _page_result():
    if not CHROME.exists():
        pytest.fail("Chrome is not installed at the expected path")
    http_port = _free_port()
    cdp_port = _free_port()
    server = ThreadingHTTPServer(("127.0.0.1", http_port), lambda *args: _Handler(*args, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    profile = tempfile.mkdtemp(prefix="texmetrics-pin-")
    chrome = subprocess.Popen(
        [
            str(CHROME),
            "--headless=new",
            "--disable-gpu",
            "--remote-debugging-port=%d" % cdp_port,
            "--user-data-dir=" + profile,
            "--window-size=1280,800",
            "--no-first-run",
            "--disable-extensions",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 20
        started = False
        while time.time() < deadline:
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % cdp_port, timeout=1) as resp:
                    json.load(resp)
                    started = True
                    break
            except Exception:
                time.sleep(0.2)
        if not started:
            pytest.fail("Chrome debugging port did not open")

        async def run():
            req = urllib.request.Request("http://127.0.0.1:%d/json/new?about:blank" % cdp_port, method="PUT")
            with urllib.request.urlopen(req, timeout=10) as resp:
                page = json.load(resp)
            async for call in _cdp(page["webSocketDebuggerUrl"]):
                await call("Runtime.enable")
                await call("Page.enable")
                await call(
                    "Page.addScriptToEvaluateOnNewDocument",
                    {
                        "source": """
window.__pageErrors = [];
window.addEventListener('error', function (event) {
  window.__pageErrors.push({
    message: String(event.message || ''),
    stack: event.error && event.error.stack ? String(event.error.stack) : ''
  });
});
window.addEventListener('unhandledrejection', function (event) {
  const reason = event.reason;
  window.__pageErrors.push({
    message: String(reason && reason.message ? reason.message : reason),
    stack: reason && reason.stack ? String(reason.stack) : ''
  });
});
"""
                    },
                )
                await call("Page.navigate", {"url": "http://127.0.0.1:%d/index.html" % http_port})
                ready = None
                for _ in range(60):
                    await asyncio.sleep(0.5)
                    probed = await call(
                        "Runtime.evaluate",
                        {
                            "expression": "window.__texmetricsMapState && window.__texmetricsMapState.markersByKey ? window.__texmetricsMapState.markersByKey.size : 0",
                            "returnByValue": True,
                        },
                    )
                    ready = ((probed.get("result") or {}).get("result") or {}).get("value")
                    if isinstance(ready, int) and ready >= 1000:
                        break
                clicked = await call(
                    "Runtime.evaluate",
                    {"expression": CLICK_JS, "awaitPromise": True, "returnByValue": True},
                    timeout=30,
                )
                details = (clicked.get("result") or {}).get("exceptionDetails")
                value = ((clicked.get("result") or {}).get("result") or {}).get("value")
                if details and not value:
                    return {"ok": False, "why": "evaluate threw", "errors": [{"message": details.get("text", ""), "stack": json.dumps(details)[:1200]}], "markers": ready or 0}
                return value or {"ok": False, "why": "no value", "errors": [{"message": "empty evaluate"}], "markers": ready or 0}

        return asyncio.run(run())
    finally:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(chrome.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server.shutdown()


def test_pin_click_page_errors_are_empty():
    result = _page_result()
    assert result.get("markers") == 3720
    assert "Preview report · $129" in (result.get("edge") or {}).get("text", "")
    assert "Preview report · $129" in (result.get("middle") or {}).get("text", "")
    assert str((result.get("edge") or {}).get("rn", "")).startswith("RN")
    assert str((result.get("middle") or {}).get("rn", "")).startswith("RN")
    assert result.get("errors") == []
