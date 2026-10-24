"""Map preview popup, lookup, and GoatCounter. Source checks. No network."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
VIOL = (ROOT / "violation-sites.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
EMBED = (ROOT / "embed.html").read_text(encoding="utf-8")

ORIGIN = "https://texmetrics-pdf-private-production.up.railway.app"
COUNT = '<script data-goatcounter="https://texmetrics.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>'
NOT_ON_MAP = "This site is not on the TexMetrics map, so a report is not available."


def test_m1_popup_label_and_click_attr():
    assert "Preview report \\\\u00b7 $129" in APP
    assert 'data-goatcounter-click=\\"click-preview\\"' in APP
    assert "Preview report · $129" in VIOL
    assert 'data-goatcounter-click="click-preview"' in VIOL


def test_m2_preview_opens_reports_origin_and_checkout_is_unused():
    assert "REPORTS_ORIGIN" in APP
    assert ORIGIN in APP
    assert 'window.__texmetricsOpenReport = previewReport' in APP
    assert "function openReportCta(rn)" in APP
    assert "window.__texmetricsOpenReport = openReportCta" not in APP


def test_m3_covestro_still_opens_the_free_sample():
    assert "RN100209931" in APP
    assert "TexMetrics_RN100209931_Compliance_Report.pdf" in APP
    assert "Get the TexMetrics report for this site" in VIOL


def test_m4_one_count_script_and_no_explicit_count():
    assert INDEX.count(COUNT) == 1
    assert EMBED.count(COUNT) == 1
    assert "goatcounter.count" not in APP
    assert "goatcounter.count" not in VIOL


def test_m5_lookup_uses_loaded_sites_and_caps_at_10():
    assert "Look up your site" in VIOL
    assert "LIST_CAP = 10" in VIOL
    assert VIOL.count("fetch(") == 1


def test_m6_rn_not_on_map():
    assert NOT_ON_MAP in VIOL


def test_m7_embed_query_param_still_works():
    assert "__TEXMETRICS_Q__" in EMBED
    assert '.get("q")' in EMBED


def test_m8_no_new_lookup_network():
    assert VIOL.count("fetch(") == 1
    start = VIOL.index("function syncSearch")
    end = VIOL.index("function orderYears", start)
    assert "fetch(" not in VIOL[start:end]
