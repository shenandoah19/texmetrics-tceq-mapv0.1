"""Typing in the map search box uses every year. An empty box stays on 5 years.

The live page patches pinned app.js. filterOrders drops an order older than
filters.dateFrom before it reads the search text. This test runs that same
date-then-text filter on tceq-orders.json, with the patch's window rule:
text widens to all years, and clearing restores the window from before typing.
"""
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


def _iso(value) -> str:
    text = str(value or "").strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    parts = text.replace(",", "").split()
    if len(parts) != 3:
        return text
    month = MONTHS.get(parts[0][:3].lower())
    if not month:
        return text
    return f"{parts[2]}-{month}-{int(parts[1]):02d}"


def _years_ago(n: int, now: datetime) -> str:
    shifted = now.replace(year=now.year - n)
    return shifted.strftime("%Y-%m-%d")


def _load():
    doc = json.loads(ORDERS.read_text(encoding="utf-8"))
    orders = []
    earliest = ""
    latest = ""
    for raw in doc["orders"]:
        order = dict(raw)
        order["orderDate"] = _iso(order.get("orderDate"))
        orders.append(order)
        if order["orderDate"] and (not earliest or order["orderDate"] < earliest):
            earliest = order["orderDate"]
        if order["orderDate"] and (not latest or order["orderDate"] > latest):
            latest = order["orderDate"]
    return orders, earliest, latest


def _preset(preset_id, date_min, date_max, now):
    if preset_id == "all":
        return date_min or "", date_max or ""
    start = _years_ago(5, now)
    if date_min and start < date_min:
        start = date_min
    return start, date_max or ""


def filter_orders(orders, query, date_from, date_to):
    """Same drop order as pinned filterOrders: date window, then search text."""
    q = query.strip().lower()
    kept = []
    for index, order in enumerate(orders):
        if date_from and order["orderDate"] < date_from:
            continue
        if date_to and order["orderDate"] > date_to:
            continue
        if not q:
            kept.append(index)
            continue
        fields = (
            order.get("customer"),
            order.get("county"),
            order.get("caseNo"),
            order.get("docket"),
            order.get("rn"),
            order.get("siteName"),
            order.get("reName"),
            order.get("address"),
            order.get("city"),
            order.get("program"),
        )
        if any(q in str(field or "").lower() for field in fields):
            kept.append(index)
    return kept


class SearchBox:
    """The patched render plus the search-box input handler."""

    def __init__(self, orders, date_min, date_max, now, preset_id="5y"):
        self.orders = orders
        self.date_min = date_min
        self.date_max = date_max
        self.now = now
        self.date_from, self.date_to = _preset(preset_id, date_min, date_max, now)
        self.query = ""
        self.saved = None

    def render(self):
        if self.query.strip():
            if self.saved is None:
                self.saved = (self.date_from, self.date_to)
            self.date_from, self.date_to = _preset("all", self.date_min, self.date_max, self.now)
        return filter_orders(self.orders, self.query, self.date_from, self.date_to)

    def type(self, text):
        self.query = text
        if not str(self.query or "").strip() and self.saved is not None:
            self.date_from, self.date_to = self.saved
            self.saved = None
        return self.render()

    def show_all_years(self, checked):
        """Checkbox. A click while text is present does not shrink the search."""
        preset_id = "all" if checked else "5y"
        self.date_from, self.date_to = _preset(preset_id, self.date_min, self.date_max, self.now)
        if not self.query.strip():
            self.saved = None
        return self.render()


def test_patch_saves_the_window_and_widens_before_the_filter():
    saved = APP.index("window.__texmetricsSearchYears = { dateFrom: filters.dateFrom, dateTo: filters.dateTo }")
    widened = APP.index('Object.assign(filters, applyPreset(\\"all\\", payload.meta.dateMin, payload.meta.dateMax))', saved)
    visible = APP.index("const visible = filterOrders(payload.orders, filters);", widened)
    assert saved < widened < visible
    assert "window.__texmetricsSearchYears = null" in APP
    assert "Show all years" in APP
    assert 'dateId === \\"all\\" ? \\" checked\\"' in APP
    assert 'applyPreset(allYears.checked ? \\"all\\" : \\"5y\\"' in APP


def test_typed_rn_uses_all_years_and_clear_restores_five_years():
    orders, date_min, date_max = _load()
    now = datetime.now(timezone.utc)
    five_from, five_to = _preset("5y", date_min, date_max, now)
    before = filter_orders(orders, "", five_from, five_to)

    box = SearchBox(orders, date_min, date_max, now)
    empty = box.render()
    assert empty == before

    tpc = box.type("RN104964267")
    assert len(tpc) == 6
    assert {orders[i]["orderDate"] for i in tpc} == {
        "2016-03-04", "2016-07-12", "2017-07-27", "2018-06-05", "2019-03-01", "2019-04-23",
    }

    lake = box.type("RN109162057")
    assert len(lake) == 3
    assert {orders[i]["orderDate"] for i in lake} == {"2017-03-21", "2018-07-31", "2018-08-15"}

    cleared = box.type("")
    assert cleared == before
    assert box.date_from == five_from
    assert box.date_to == five_to

    # The toggle was already on, so clearing stays on all years.
    wide = SearchBox(orders, date_min, date_max, now, preset_id="all")
    wide_before = wide.render()
    assert len(wide_before) > len(before)
    assert len(wide.type("RN104964267")) == 6
    assert wide.type("") == wide_before

    # Unchecking the box while text remains does not drop the old orders.
    fresh = SearchBox(orders, date_min, date_max, now)
    assert len(fresh.type("RN104964267")) == 6
    assert len(fresh.show_all_years(False)) == 6
    assert fresh.type("") == before
