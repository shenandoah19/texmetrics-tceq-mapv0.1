"""Search and ?q= use all years. The default view stays on 5 years."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
ORDERS = ROOT / "tceq-orders.json"

MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}


def _iso(value: str) -> str:
    text = str(value or "").strip()
    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    parts = text.replace(",", "").split()
    if len(parts) != 3:
        return text
    month = MONTHS.get(parts[0][:3].lower())
    if not month:
        return text
    return f"{parts[2]}-{month}-{int(parts[1]):02d}"


def _site_key(order: dict) -> str:
    rn = str(order.get("rn") or "").strip().upper()
    if rn:
        return rn
    lat = float(order.get("lat") or 0)
    lon = float(order.get("lon") or 0)
    return f"GEO:{lat:.5f},{lon:.5f}"


def test_search_keeps_all_years_and_a_toggle_exists():
    assert 'Object.assign(filters, applyPreset(\\"5y\\"' not in APP
    assert '...applyPreset(\\"5y\\"' not in APP
    assert "Show all years" in APP
    assert 'applyPreset(allYears.checked ? \\"all\\" : \\"5y\\"' in APP


def test_order_file_counts_and_named_rns():
    doc = json.loads(ORDERS.read_text(encoding="utf-8"))
    orders = doc["orders"]
    assert len(orders) == 12408
    sites = {_site_key(order) for order in orders}
    assert len(sites) == 9307
    cutoff = datetime.now(timezone.utc)
    cutoff = cutoff.replace(year=cutoff.year - 5).strftime("%Y-%m-%d")
    recent = {
        _site_key(order)
        for order in orders
        if _iso(order.get("orderDate")) >= cutoff
    }
    if cutoff == "2021-10-24":
        assert len(recent) == 3720
    by_rn = {}
    for order in orders:
        rn = str(order.get("rn") or "").strip().upper()
        if rn:
            by_rn.setdefault(rn, []).append(_iso(order.get("orderDate")))
    assert "RN111142097" in by_rn
    assert max(by_rn["RN100648096"]) == "2019-09-16"
    assert "RN100648096" not in recent
