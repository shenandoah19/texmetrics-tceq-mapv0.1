"""The map preview button carries one GoatCounter click name. No network."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
CLICK = "data-goatcounter-click=\\\"click-preview\\\""
PREVIEW = "https://reports.texmetrics.com/rn/"
CHECKOUT = "https://texmetrics-pdf-private-production.up.railway.app/checkout"


def _report_cta_chunk(text: str) -> str:
    start = text.index("function reportCtaHtml")
    end = text.index("Public TCEQ compilation", start)
    return text[start:end]


def test_buy_button_is_marked_for_goatcounter():
    text = APP.read_text(encoding="utf-8")
    chunk = _report_cta_chunk(text)
    assert chunk.count(CLICK) == 1
    assert text.count(CLICK) == 1
    assert "class=\\\"report-cta-button " in chunk
    assert "data-rn=\\\"" in chunk
    assert "Preview report" in chunk
    assert "$" not in chunk
    assert PREVIEW in text
    assert 'window.open(url, \\"_blank\\", \\"noopener\\")' in text
    assert CHECKOUT not in text
    assert "/checkout" not in text
