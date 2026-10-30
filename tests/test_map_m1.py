"""Map M1. Preview report opens the preview page in a new tab. No checkout."""
import json
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
VIOL = (ROOT / "violation-sites.js").read_text(encoding="utf-8")
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PREVIEW = "https://reports.texmetrics.com/rn/"
SAMPLE = "RN100209931"
SAMPLE_PDF = "TexMetrics_RN100209931_Compliance_Report.pdf"
NOTE = "The full report can include later Commission Issued Orders not in this file."
PAGE_FILES = (
    "app.js",
    "violation-sites.js",
    "index.html",
    "embed.html",
    "parent-query.js",
    "styles.css",
)


def _between(text, start, end):
    i = text.index(start)
    return text[i:text.index(end, i)]


def _page_text():
    return "\n".join((ROOT / name).read_text(encoding="utf-8") for name in PAGE_FILES)


def _unescape_injected(app, start_token, end_token):
    start = app.rfind("\n", 0, app.index(start_token)) + 1
    end = app.rfind("\n", 0, app.index(end_token, start)) + 1
    lines = []
    for line in app[start:end].splitlines():
        raw = line.strip()
        if raw.startswith('"') and raw.endswith('",'):
            raw = raw[1:-2]
        elif raw.startswith('"') and raw.endswith('"'):
            raw = raw[1:-1]
        else:
            continue
        lines.append(raw.replace('\\"', '"').replace("\\\\", "\\"))
    return "\n".join(lines)


def _run_page(script):
    if not CHROME.exists():
        pytest.fail("Chrome is not installed at the expected path")
    html = (
        "<!doctype html><pre id=\"out\"></pre><script>\n"
        + script
        + "\n</script>"
    )
    with tempfile.TemporaryDirectory(prefix="texmetrics-m1-") as folder:
        path = Path(folder) / "page.html"
        path.write_text(html, encoding="utf-8")
        proc = subprocess.run(
            [
                str(CHROME),
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--disable-extensions",
                "--virtual-time-budget=4000",
                "--dump-dom",
                path.as_uri(),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    assert proc.returncode == 0, proc.stderr
    body = proc.stdout
    start = body.index("<pre")
    start = body.index(">", start) + 1
    end = body.index("</pre>", start)
    return json.loads(body[start:end])


def test_popup_and_card_labels_are_preview_report_with_no_price():
    app_label = _between(APP, "function reportCtaHtml", "Public TCEQ compilation")
    card_label = _between(VIOL, "function reportLabel", "function openNewTab")
    assert ': \\"Preview report\\"' in app_label
    assert "$" not in app_label
    assert 'return "Preview report";' in card_label
    assert "$" not in card_label
    assert SAMPLE in app_label
    assert "Get the TexMetrics report for this site" in app_label
    assert "Get the TexMetrics report for this site" in card_label


def test_note_drops_the_price_and_keeps_the_meaning():
    assert NOTE in APP
    assert NOTE in VIOL
    assert "$129" not in APP
    assert "$129" not in VIOL


def test_no_checkout_from_the_map():
    pages = _page_text()
    assert "/checkout" not in pages
    assert "checkoutNonce" not in pages
    assert "Could not start checkout" not in pages
    assert "function openReportCta" not in pages
    assert "texmetrics-pdf-private-production.up.railway.app" not in pages


def test_goatcounter_name_is_click_preview():
    assert 'data-goatcounter-click=\\"click-preview\\"' in APP
    assert 'data-goatcounter-click="click-preview"' in VIOL
    assert "click-buy" not in APP
    assert "click-buy" not in VIOL


def test_click_opens_the_preview_url_and_blocked_popup_stays_in_a_new_tab():
    app_js = _unescape_injected(
        APP,
        "function openNewTab(url)",
        "window.__texmetricsOpenReport = previewReport;",
    )
    viol_js = _between(VIOL, "function openNewTab(url)", "function reportHtml")
    script = app_js + "\n" + viol_js + r"""
const log = [];
window.open = function (url, target, features) {
  log.push({kind: "open", url: String(url), target: String(target), features: String(features)});
  return window.__block ? null : {closed: false};
};
HTMLAnchorElement.prototype.click = function () {
  log.push({kind: "anchor", href: this.href, target: this.target, rel: this.rel});
};
function urlsFor(rn) {
  const before = log.length;
  previewReport(rn);
  return log.slice(before);
}
const normal = urlsFor("rn102679867");
const second = urlsFor("RN102693520");
const third = urlsFor("rn100214303");
window.__block = true;
const blocked = urlsFor("RN102679867");
const sample = urlsFor("rn100209931");
document.getElementById("out").textContent = JSON.stringify({
  normal: normal,
  second: second,
  third: third,
  blocked: blocked,
  sample: sample,
  location: location.href
});
"""
    got = _run_page(script)
    assert got["normal"] == [{
        "kind": "open",
        "url": PREVIEW + "RN102679867",
        "target": "_blank",
        "features": "noopener",
    }]
    assert got["second"][0]["url"] == PREVIEW + "RN102693520"
    assert got["third"][0]["url"] == PREVIEW + "RN100214303"
    assert got["blocked"][0]["kind"] == "open"
    assert got["blocked"][0]["url"] == PREVIEW + "RN102679867"
    assert got["blocked"][1] == {
        "kind": "anchor",
        "href": PREVIEW + "RN102679867",
        "target": "_blank",
        "rel": "noopener",
    }
    assert len(got["blocked"]) == 2
    assert got["sample"][0]["kind"] == "open"
    assert got["sample"][0]["url"].endswith(SAMPLE_PDF)
    assert "reports.texmetrics.com" not in got["sample"][0]["url"]
    assert all(item["target"] == "_blank" for item in got["sample"])
    assert "reports.texmetrics.com" not in "".join(item.get("href", "") + item.get("url", "") for item in got["sample"])
