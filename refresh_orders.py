"""Rebuild tceq-orders.json from the TCEQ agreed-orders extract.

Same Open Data file the map already uses:
https://data.texas.gov/api/views/u66a-qggj/rows.csv?accessType=DOWNLOAD

RN comes from the NOE docket join the map already uses
(https://data.texas.gov/api/views/rua3-iswk/rows.csv?accessType=DOWNLOAD).
An RN already on the map keeps its pin. This does not change search,
the popup, or the report button.

From this folder, weekly or whenever:

    py -3.12 refresh_orders.py
"""

from __future__ import annotations

import csv
import json
import re
import tempfile
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "tceq-orders.json"
ORDERS_URL = "https://data.texas.gov/api/views/u66a-qggj/rows.csv?accessType=DOWNLOAD"
NOES_URL = "https://data.texas.gov/api/views/rua3-iswk/rows.csv?accessType=DOWNLOAD"
DOCKET_RE = re.compile(r"\d{4}-\d{4}-[A-Z]{2,5}-E", re.IGNORECASE)
MIN_MAPPED = 500

ORDER_DOCKET = ["TCEQ Docket No.", "TCEQ Docket No", "Docket", "Docket Number"]
NOE_DOCKET = ["TCEQ Docket Number(s) & Creation Dates"]
NOE_RN = ["Regulated Entity Number", "RN"]


def _clean(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "<na>"}:
        return ""
    return text


def _rn(value: object) -> str:
    text = _clean(value).upper()
    return text if text.startswith("RN") else ""


def _num(value: object) -> float:
    text = _clean(value).replace(",", "").replace("$", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _pick(fields: list[str] | None, candidates: list[str]) -> str | None:
    lower = {name.lower().strip(): name for name in (fields or [])}
    for candidate in candidates:
        found = lower.get(candidate.lower())
        if found:
            return found
    return None


def _dockets(value: object) -> list[str]:
    return [match.upper() for match in DOCKET_RE.findall(_clean(value))]


def _order_date(value: object) -> tuple[str, date | None]:
    text = _clean(value)
    if not text:
        return "", None
    for fmt in ("%b %d, %Y", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            parsed = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        return parsed.strftime("%b %d, %Y"), parsed
    return text, None


def _in_texas(lat: float, lon: float) -> bool:
    return 25.7 <= lat <= 36.6 and -106.7 <= lon <= -93.4


def _ssl_context():
    try:
        import certifi
        import ssl
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


def _download(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "TexMetrics-map-refresh"})
    with urllib.request.urlopen(request, timeout=180, context=_ssl_context()) as response, dest.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
    if dest.stat().st_size < 1000:
        raise RuntimeError(f"Download was empty: {url}")


def _site_index(orders: list[dict]) -> dict[str, dict]:
    sites: dict[str, dict] = {}
    for order in orders:
        rn = _rn(order.get("rn"))
        if rn and rn not in sites:
            sites[rn] = order
    return sites


def _docket_index(orders: list[dict]) -> dict[str, str]:
    found: dict[str, str] = {}
    for order in orders:
        rn = _rn(order.get("rn"))
        if not rn:
            continue
        for docket in _dockets(order.get("docket")):
            found.setdefault(docket, rn)
    return found


def _noe_index(path: Path) -> tuple[dict[str, str], dict[str, Counter], dict[str, Counter]]:
    docket_to_rn: dict[str, str] = {}
    coords: dict[str, Counter] = defaultdict(Counter)
    names: dict[str, Counter] = defaultdict(Counter)
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.DictReader(handle)
        docket_col = _pick(reader.fieldnames, NOE_DOCKET)
        rn_col = _pick(reader.fieldnames, NOE_RN)
        if docket_col is None or rn_col is None:
            raise RuntimeError(f"NOE file is missing docket or RN. Columns: {reader.fieldnames}")
        fields = {name.strip(): name for name in (reader.fieldnames or [])}
        lat_col = fields.get("Latitude", "Latitude")
        lon_col = fields.get("Longitude", "Longitude")
        name_col = fields.get("Regulated Entity Name", "Regulated Entity Name")
        for row in reader:
            rn = _rn(row.get(rn_col))
            if not rn:
                continue
            for docket in _dockets(row.get(docket_col)):
                docket_to_rn.setdefault(docket, rn)
            name = _clean(row.get(name_col))
            if name:
                names[rn][name] += 1
            try:
                lat = float(_clean(row.get(lat_col)))
                lon = float(_clean(row.get(lon_col)))
            except ValueError:
                continue
            if _in_texas(lat, lon):
                coords[rn][(round(lon, 6), round(lat, 6))] += 1
    return docket_to_rn, coords, names


def _most(counter: Counter) -> str:
    if not counter:
        return ""
    return counter.most_common(1)[0][0]


def _blank_site(rn: str, coords: dict[str, Counter], names: dict[str, Counter]) -> dict | None:
    points = coords.get(rn)
    if not points:
        return None
    lon, lat = points.most_common(1)[0][0]
    name = _most(names.get(rn) or Counter())
    return {
        "loc": "site",
        "reClass": "UNCLASSIFIED",
        "reName": name,
        "siteName": name,
        "address": "",
        "city": "",
        "biz": "Unknown",
        "clon": None,
        "clat": None,
        "lon": lon,
        "lat": lat,
        "violTotal": 0,
        "violActive": 0,
        "violRepeat": 0,
        "violMajor": 0,
    }


def build(orders_csv: Path, noes_csv: Path, current: dict) -> dict:
    previous = current.get("orders") or []
    sites = _site_index(previous)
    known_dockets = _docket_index(previous)
    previous_by_docket: dict[str, dict] = {}
    for order in previous:
        for docket in _dockets(order.get("docket")):
            previous_by_docket.setdefault(docket, order)
    noe_dockets, noe_coords, noe_names = _noe_index(noes_csv)

    with orders_csv.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.DictReader(handle)
        docket_col = _pick(reader.fieldnames, ORDER_DOCKET)
        if docket_col is None or "Order Date" not in (reader.fieldnames or []):
            raise RuntimeError(f"Orders file is missing docket or Order Date. Columns: {reader.fieldnames}")
        rows = list(reader)

    orders = []
    skipped = 0
    programs: set[str] = set()
    counties: set[str] = set()
    classes: set[str] = set()
    payables: list[float] = []
    parsed_dates: list[date] = []
    for row in rows:
        dockets = _dockets(row.get(docket_col))
        rn = ""
        for docket in dockets:
            rn = noe_dockets.get(docket) or known_dockets.get(docket) or ""
            if rn:
                break
        existing = None
        for docket in dockets:
            existing = previous_by_docket.get(docket)
            if existing:
                break
        # A docket already on the map keeps that row's pin, including a county pin with no RN.
        if existing is not None and existing.get("lat") is not None and existing.get("lon") is not None:
            site = existing
            rn = _rn(existing.get("rn")) or rn
        elif not rn:
            skipped += 1
            continue
        else:
            site = sites.get(rn) or _blank_site(rn, noe_coords, noe_names)
            if site is None:
                skipped += 1
                continue
        shown, parsed = _order_date(row.get("Order Date"))
        county = _clean(row.get("County")).upper() or _clean(site.get("county")).upper()
        program = _clean(row.get("Program"))
        payable = _num(row.get("Payable Amount"))
        sep = _num(row.get("SEP Offset"))
        orders.append(
            {
                "caseNo": _clean(row.get("Case No.")),
                "docket": _clean(row.get(docket_col)),
                "customer": _clean(row.get("Customer Name")),
                "payable": payable,
                "assessed": _num(row.get("Penalty Assessed")),
                "deferred": _num(row.get("Penalty Deferred")),
                "sep": sep,
                "orderDate": shown,
                "program": program,
                "county": county,
                "rn": rn,
                "loc": site.get("loc"),
                "reClass": site.get("reClass") or "UNCLASSIFIED",
                "reName": site.get("reName") or "",
                "siteName": site.get("siteName") or "",
                "address": site.get("address") or "",
                "city": site.get("city") or "",
                "biz": site.get("biz") or "Unknown",
                "clon": site.get("clon"),
                "clat": site.get("clat"),
                "lon": site.get("lon"),
                "lat": site.get("lat"),
                "violTotal": int(site.get("violTotal") or 0),
                "violActive": int(site.get("violActive") or 0),
                "violRepeat": int(site.get("violRepeat") or 0),
                "violMajor": int(site.get("violMajor") or 0),
            }
        )
        if program:
            programs.add(program)
        if county:
            counties.add(county)
        classes.add(orders[-1]["reClass"])
        payables.append(round(payable + sep, 2))
        if parsed:
            parsed_dates.append(parsed)

    for order in orders:
        prior = None
        for docket in _dockets(order.get("docket")):
            prior = previous_by_docket.get(docket)
            if prior:
                break
        if prior is not None:
            same_pin = (order["lat"], order["lon"], order["loc"]) == (
                prior.get("lat"),
                prior.get("lon"),
                prior.get("loc"),
            )
            if not same_pin:
                raise RuntimeError(f"Pin moved for docket {order.get('docket')}")
            continue
        old = sites.get(order["rn"])
        if old is None:
            continue
        if (order["lat"], order["lon"], order["loc"]) != (old.get("lat"), old.get("lon"), old.get("loc")):
            raise RuntimeError(f"Pin moved for {order['rn']}")

    if len(orders) < MIN_MAPPED or len(orders) < len(previous) / 2:
        raise RuntimeError(
            f"Refusing to replace the map. New orders={len(orders)} previous={len(previous)}"
        )
    if not parsed_dates:
        raise RuntimeError("No order dates parsed")

    newest = max(parsed_dates)
    oldest = min(parsed_dates)
    site_located = sum(1 for order in orders if order["loc"] == "site")
    county_located = sum(1 for order in orders if order["loc"] == "county")
    document = {
        "meta": {
            "source": "TexMetrics TCEQ extract (Agreed Orders + NOE sites + compliance history + violations)",
            "sourceUrl": "https://www.texmetrics.com/agreed-orders",
            "generated": date.today().isoformat(),
            "mapped": len(orders),
            "siteLocated": site_located,
            "countyLocated": county_located,
            "skippedCoords": skipped,
            "skippedPayable": 0,
            "totalPayable": round(sum(payables), 2),
            "maxPayable": max(payables) if payables else 0,
            "dateMin": oldest.strftime("%b %d, %Y"),
            "dateMax": newest.strftime("%b %d, %Y"),
        },
        "programs": sorted(programs),
        "counties": sorted(counties),
        "classes": sorted(classes),
        "businessTypes": ["Unknown"],
        "orders": orders,
    }
    print(
        f"orders={len(orders)} newest={newest.isoformat()} "
        f"oldest={oldest.isoformat()} skipped={skipped}"
    )
    return document


def main() -> None:
    current = json.loads(OUT.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        orders_csv = folder / "administrative_orders.csv"
        noes_csv = folder / "noes.csv"
        print("Downloading agreed orders")
        _download(ORDERS_URL, orders_csv)
        print("Downloading NOE join")
        _download(NOES_URL, noes_csv)
        document = build(orders_csv, noes_csv, current)
    tmp_out = OUT.with_suffix(".json.tmp")
    tmp_out.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp_out.replace(OUT)


if __name__ == "__main__":
    main()
