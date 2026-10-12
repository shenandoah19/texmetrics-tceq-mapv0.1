"""Rebuild tceq-orders.json from TCEQ Open Data plus newer Commission Issued Orders.

Open Data file the map already uses:
https://data.texas.gov/api/views/u66a-qggj/rows.csv?accessType=DOWNLOAD

RN for those rows comes from the NOE docket join the map already uses
(https://data.texas.gov/api/views/rua3-iswk/rows.csv?accessType=DOWNLOAD).
An order already on the map keeps its pin.

AIR-E orders newer than that extract come from one CIO date search:
https://www14.tceq.texas.gov/epic/CIO/index.cfm?fuseaction=search.searchByDate
FromDate is the newest Open Data order date minus 60 days. ToDate is today.
A docket in both sources keeps the Open Data row. A new CIO row uses the
NOE facility coordinate for its RN, then that county's existing center.
This does not change search, the popup, or the report button.

From this folder, weekly or whenever:

    py -3.12 refresh_orders.py
"""

from __future__ import annotations

import csv
import json
import re
import tempfile
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "tceq-orders.json"
ORDERS_URL = "https://data.texas.gov/api/views/u66a-qggj/rows.csv?accessType=DOWNLOAD"
NOES_URL = "https://data.texas.gov/api/views/rua3-iswk/rows.csv?accessType=DOWNLOAD"
CIO_DATE_URL = "https://www14.tceq.texas.gov/epic/CIO/index.cfm?fuseaction=search.searchByDate"
CIO_PDF_URL = (
    "https://www14.tceq.texas.gov/epic/CIO/index.cfm"
    "?fuseaction=search.download&agy_dkt_num_txt={docket}"
)
DOCKET_RE = re.compile(r"\d{4}-\d{4}-[A-Z]{2,5}-E", re.IGNORECASE)
MIN_MAPPED = 500
CIO_LOOKBACK_DAYS = 60

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


def _post_form(url: str, form: dict[str, str]) -> str:
    payload = urllib.parse.urlencode(form).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "User-Agent": "TexMetrics-map-refresh",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html",
        },
    )
    with urllib.request.urlopen(request, timeout=300, context=_ssl_context()) as response:
        html = response.read().decode("utf-8", "replace")
    if len(html) < 1000:
        raise RuntimeError("CIO date search returned an empty page")
    return html


def _plain(fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", fragment or "", flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    return re.sub(r"[ \t]+", " ", text).strip()


def _split_respondent(issued: str) -> tuple[str, str]:
    text = _plain(issued)
    match = re.search(r"^(.*?),\s*(CN\d+)\s*$", text, re.IGNORECASE)
    if not match:
        return text, ""
    return match.group(1).strip(), match.group(2).upper()


def _rn_from_text(text: str) -> str:
    """RN plus 9 digits, or 9 bare digits written after the county."""
    match = re.search(r"\bRN\s*(\d{9})\b", text, re.IGNORECASE)
    if match:
        return "RN" + match.group(1)
    match = re.search(r"County;\s*(\d{9})\b", text, re.IGNORECASE)
    if match:
        return "RN" + match.group(1)
    return ""


def _county_from_text(text: str) -> str:
    match = re.search(r"\bin\s+([A-Za-z][A-Za-z .'-]*?)\s+County\b", text, re.IGNORECASE)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip().upper()


def _parse_cio_html(html: str) -> list[dict]:
    """One CIO date-search page. Same docket-link split as search_cio_by_rn."""
    if "must input some search parameters" in (html or "").lower():
        raise RuntimeError("CIO date search ignored FromDate and ToDate")
    chunks = (html or "").split("agy_dkt_num_txt=")[1:]
    hits: list[dict] = []
    seen: set[str] = set()
    for chunk in chunks:
        docket_m = DOCKET_RE.match(chunk)
        if not docket_m:
            continue
        docket = docket_m.group(0).upper()
        if docket in seen:
            continue
        seen.add(docket)
        date_m = re.search(
            r"Agenda Date:\s*</span>\s*(\d{2}/\d{2}/\d{4})",
            chunk,
            re.IGNORECASE,
        )
        pen_m = re.search(
            r"Penalty Amount:\s*</span>\s*\$?\s*([0-9][0-9,]*)",
            chunk,
            re.IGNORECASE,
        )
        issued_m = re.search(
            r"Order Issued To:.*?<div[^>]*>\s*([^<]+)",
            chunk,
            re.IGNORECASE | re.DOTALL,
        )
        respondent, cn = _split_respondent(issued_m.group(1) if issued_m else "")
        sum_m = re.search(
            r"Summary:\s*</span>\s*</div>\s*<div[^>]*>(.{0,8000}?)</div>",
            chunk,
            re.IGNORECASE | re.DOTALL,
        )
        summary = _plain(sum_m.group(1) if sum_m else "")
        # A few CIO rows use "?" where the sentence should have a space.
        english = summary.split("Consideración")[0].replace("?", " ")
        english = re.sub(r"\s+", " ", english).strip()
        type_m = re.search(
            r"\b((?:Agreed|Default|Commission|Emergency)\s+Order)\b",
            english,
            re.IGNORECASE,
        )
        hits.append(
            {
                "docket": docket,
                "agenda_date": date_m.group(1) if date_m else "",
                "penalty": float(pen_m.group(1).replace(",", "")) if pen_m else None,
                "respondent": respondent,
                "cn": cn,
                "rn": _rn_from_text(english),
                "county": _county_from_text(english),
                "order_type": type_m.group(1).title() if type_m else "",
                "pdf_url": CIO_PDF_URL.format(docket=docket),
            }
        )
    if not hits:
        if re.search(r"Agenda Date:|Penalty Amount:", html or "", re.IGNORECASE):
            raise RuntimeError("CIO shows order labels but no docket links")
        raise RuntimeError("CIO date search parsed zero orders")
    air = [hit for hit in hits if hit["docket"].endswith("-AIR-E")]
    broken = [
        hit["docket"]
        for hit in air
        if not hit["docket"] or not hit["rn"] or not hit["county"]
    ]
    if broken:
        shown = ", ".join(broken[:8])
        raise RuntimeError(
            f"CIO AIR-E rows missing docket, RN, or county ({len(broken)}): {shown}"
        )
    return air


def _fetch_cio(start: date, end: date) -> list[dict]:
    print(f"CIO date search {start.isoformat()} to {end.isoformat()}")
    html = _post_form(
        CIO_DATE_URL,
        {"FromDate": start.isoformat(), "ToDate": end.isoformat()},
    )
    return _parse_cio_html(html)


def _county_centers(orders: list[dict]) -> dict[str, tuple[float, float]]:
    counts: dict[str, Counter] = defaultdict(Counter)
    for order in orders:
        county = _clean(order.get("county")).upper()
        if not county:
            continue
        if order.get("loc") == "county" and order.get("lat") is not None and order.get("lon") is not None:
            counts[county][(float(order["lat"]), float(order["lon"]))] += 1
        elif order.get("clat") is not None and order.get("clon") is not None:
            counts[county][(float(order["clat"]), float(order["clon"]))] += 1
    return {county: counter.most_common(1)[0][0] for county, counter in counts.items() if counter}


def _county_point(county: str, centers: dict[str, tuple[float, float]]):
    if county in centers:
        return centers[county]
    folded = county.replace(" ", "")
    for name, point in centers.items():
        if name.replace(" ", "") == folded:
            return point
    return None


def _cio_order(hit: dict, noe_coords, noe_names, centers, sites) -> tuple[dict | None, date | None]:
    """NOE facility coordinate first, then the county center already on the map."""
    rn = hit["rn"]
    lat = lon = None
    loc = ""
    points = noe_coords.get(rn)
    if points:
        lon, lat = points.most_common(1)[0][0]
        loc = "site"
    else:
        center = _county_point(hit["county"], centers)
        if center:
            lat, lon = center
            loc = "county"
    if lat is None or lon is None:
        return None, None
    shown, parsed = _order_date(hit.get("agenda_date"))
    penalty = float(hit["penalty"] or 0.0)
    site = sites.get(rn) or {}
    name = (
        site.get("siteName")
        or site.get("reName")
        or _most(noe_names.get(rn) or Counter())
        or hit.get("respondent")
        or ""
    )
    center = _county_point(hit["county"], centers)
    return (
        {
            "caseNo": "",
            "docket": hit["docket"],
            "customer": hit.get("respondent") or "",
            "payable": penalty,
            "assessed": penalty,
            "deferred": 0.0,
            "sep": 0.0,
            "orderDate": shown,
            "program": "AIR QUALITY",
            "county": hit["county"],
            "rn": rn,
            "loc": loc,
            "reClass": site.get("reClass") or "UNCLASSIFIED",
            "reName": site.get("reName") or name,
            "siteName": site.get("siteName") or name,
            "address": site.get("address") or "",
            "city": site.get("city") or "",
            "biz": site.get("biz") or "Unknown",
            "clon": center[1] if center else None,
            "clat": center[0] if center else None,
            "lon": lon,
            "lat": lat,
            "violTotal": int(site.get("violTotal") or 0),
            "violActive": int(site.get("violActive") or 0),
            "violRepeat": int(site.get("violRepeat") or 0),
            "violMajor": int(site.get("violMajor") or 0),
            "source": "CIO",
            "cn": hit.get("cn") or "",
            "orderType": hit.get("order_type") or "",
            "pdfUrl": hit.get("pdf_url") or CIO_PDF_URL.format(docket=hit["docket"]),
        },
        parsed,
    )


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

    if not parsed_dates:
        raise RuntimeError("No order dates parsed")
    open_data_orders = len(orders)
    newest_open = max(parsed_dates)
    open_dockets = set()
    for order in orders:
        open_dockets.update(_dockets(order.get("docket")))
    cio_rows = _fetch_cio(newest_open - timedelta(days=CIO_LOOKBACK_DAYS), date.today())
    already = 0
    cio_added = 0
    cio_site = 0
    cio_county = 0
    centers = _county_centers(orders)
    for hit in cio_rows:
        if hit["docket"] in open_dockets:
            already += 1
            continue
        placed, placed_date = _cio_order(hit, noe_coords, noe_names, centers, sites)
        if placed is None:
            skipped += 1
            continue
        orders.append(placed)
        open_dockets.add(hit["docket"])
        cio_added += 1
        if placed["loc"] == "site":
            cio_site += 1
        elif placed["loc"] == "county":
            cio_county += 1
        if placed_date:
            parsed_dates.append(placed_date)
        program = placed["program"]
        if program:
            programs.add(program)
        if placed["county"]:
            counties.add(placed["county"])
        classes.add(placed["reClass"])
        payables.append(round(placed["payable"] + placed["sep"], 2))

    print(f"Open Data orders: {open_data_orders}")
    print(f"CIO orders added: {cio_added}")
    print(f"CIO dockets already in Open Data: {already}")
    print(f"CIO new site pins: {cio_site}")
    print(f"CIO new county pins: {cio_county}")

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
        if order.get("source") == "CIO":
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
            "dateMin": oldest.isoformat(),
            "dateMax": newest.isoformat(),
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
