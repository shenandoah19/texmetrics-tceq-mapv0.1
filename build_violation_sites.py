"""Build violation-sites.json from the TCEQ violations, NOV, and NOE extracts.

One record per RN with at least one active or repeat violation.
Coordinates: NOE lat/lon when present, otherwise the NOV county centroid.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "violation-sites.json"
DATA = Path(r"C:\Users\bryce\OneDrive\Desktop\Projects\texmetrics-pdf-private-1\data")
VIOLATIONS = DATA / "processed" / "violations_with_rn.csv"
NOVS = DATA / "raw" / "novs.csv"
NOES = DATA / "raw" / "noes.csv"

POINT_RE = re.compile(
    r"POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)",
    re.IGNORECASE,
)
KEEP_UPPER = {"LLC", "LP", "INC", "CO", "US", "USA", "II", "III", "IV", "LTD"}


def _open(path: Path):
    return path.open(newline="", encoding="utf-8-sig", errors="replace")


def _title(value: str) -> str:
    words = []
    for word in (value or "").split():
        if word.upper() in KEEP_UPPER:
            words.append(word.upper())
        else:
            words.append(word[:1].upper() + word[1:].lower())
    return " ".join(words)


def _in_texas(lat: float, lon: float) -> bool:
    return 24.0 <= lat <= 37.5 and -108.0 <= lon <= -92.0


def _pair(lat: float, lon: float):
    if not _in_texas(lat, lon):
        return None
    return (round(lon, 6), round(lat, 6))


def _parse_point(text: str):
    match = POINT_RE.search(text or "")
    if not match:
        return None
    lon = float(match.group(1))
    lat = float(match.group(2))
    return _pair(lat, lon)


def _parse_lat_lon(lat_text: str, lon_text: str):
    try:
        lat = float(str(lat_text).strip())
        lon = float(str(lon_text).strip())
    except (TypeError, ValueError):
        return None
    return _pair(lat, lon)


def _most(counter: Counter):
    if not counter:
        return ""
    return counter.most_common(1)[0][0]


def _truthy_repeat(value: str) -> bool:
    return (value or "").strip().upper() in {"TRUE", "T", "Y", "YES", "1"}


def main() -> None:
    counts: dict[str, dict[str, int]] = {}
    with _open(VIOLATIONS) as handle:
        for row in csv.DictReader(handle):
            rn = (row.get("RN") or "").strip().upper()
            if not rn.startswith("RN"):
                continue
            bucket = counts.get(rn)
            if bucket is None:
                bucket = {"violTotal": 0, "violActive": 0, "violRepeat": 0, "violMajor": 0}
                counts[rn] = bucket
            bucket["violTotal"] += 1
            if (row.get("Current Violation Status") or "").strip().upper() == "ACTIVE":
                bucket["violActive"] += 1
            if _truthy_repeat(row.get("Violation Repeat Indicator") or ""):
                bucket["violRepeat"] += 1
            if (row.get("Compliance History Classification") or "").strip().upper() == "MAJOR":
                bucket["violMajor"] += 1

    keep = {rn for rn, bucket in counts.items() if bucket["violActive"] > 0 or bucket["violRepeat"] > 0}

    names: dict[str, Counter] = {rn: Counter() for rn in keep}
    counties: dict[str, Counter] = {rn: Counter() for rn in keep}
    addresses: dict[str, Counter] = {rn: Counter() for rn in keep}
    cities: dict[str, Counter] = {rn: Counter() for rn in keep}
    own_centroid: dict[str, Counter] = {rn: Counter() for rn in keep}
    county_centroid: Counter = Counter()

    with _open(NOVS) as handle:
        for row in csv.DictReader(handle):
            rn = (row.get("Regulated Entity Number") or "").strip().upper()
            county = (row.get("County") or "").strip().upper()
            point = _parse_point(row.get("Coordinates (County Centroid)") or "")
            if point and county:
                county_centroid[(county, point)] += 1
            if rn not in keep:
                continue
            name = (row.get("Regulated Entity Name") or "").strip()
            address = (row.get("Physical Location") or "").strip()
            city = (row.get("Physical City") or "").strip()
            if name:
                names[rn][name] += 1
            if county:
                counties[rn][county] += 1
            if address:
                addresses[rn][address] += 1
            if city:
                cities[rn][city] += 1
            if point:
                own_centroid[rn][point] += 1

    county_point: dict[str, tuple] = {}
    by_county: dict[str, Counter] = {}
    for (county, point), n in county_centroid.items():
        by_county.setdefault(county, Counter())[point] += n
    for county, counter in by_county.items():
        county_point[county] = counter.most_common(1)[0][0]

    noe_names: dict[str, Counter] = {rn: Counter() for rn in keep}
    noe_counties: dict[str, Counter] = {rn: Counter() for rn in keep}
    noe_addresses: dict[str, Counter] = {rn: Counter() for rn in keep}
    noe_cities: dict[str, Counter] = {rn: Counter() for rn in keep}
    noe_points: dict[str, Counter] = {rn: Counter() for rn in keep}

    with _open(NOES) as handle:
        reader = csv.DictReader(handle)
        city_key = "Physical City"
        if reader.fieldnames:
            for field in reader.fieldnames:
                if field.strip().lower() == "physical city":
                    city_key = field
                    break
        for row in reader:
            rn = (row.get("Regulated Entity Number") or "").strip().upper()
            if rn not in keep:
                continue
            name = (row.get("Regulated Entity Name") or "").strip()
            county = (row.get("Physical County") or "").strip().upper()
            address = (row.get("Physical Location") or "").strip()
            city = (row.get(city_key) or "").strip()
            point = _parse_lat_lon(row.get("Latitude") or "", row.get("Longitude") or "")
            if name:
                noe_names[rn][name] += 1
            if county:
                noe_counties[rn][county] += 1
            if address:
                noe_addresses[rn][address] += 1
            if city:
                noe_cities[rn][city] += 1
            if point:
                noe_points[rn][point] += 1

    sites = []
    n_site = n_county = n_null = n_county_fallback = 0
    for rn in sorted(keep):
        bucket = counts[rn]
        name = _most(names[rn]) or _most(noe_names[rn])
        county = _most(counties[rn]) or _most(noe_counties[rn])
        address = _most(addresses[rn]) or _most(noe_addresses[rn])
        city = _most(cities[rn]) or _most(noe_cities[rn])
        point = None
        loc = None
        if noe_points[rn]:
            point = noe_points[rn].most_common(1)[0][0]
            loc = "site"
            n_site += 1
        elif own_centroid[rn]:
            point = own_centroid[rn].most_common(1)[0][0]
            loc = "county"
            n_county += 1
        elif county and county in county_point:
            point = county_point[county]
            loc = "county"
            n_county += 1
            n_county_fallback += 1
        else:
            n_null += 1
        lon, lat = point if point else (None, None)
        sites.append(
            {
                "rn": rn,
                "name": _title(name) if name else rn,
                "county": county,
                "address": _title(address) if address else "",
                "city": _title(city) if city else "",
                "lat": lat,
                "lon": lon,
                "loc": loc,
                "violTotal": bucket["violTotal"],
                "violActive": bucket["violActive"],
                "violRepeat": bucket["violRepeat"],
                "violMajor": bucket["violMajor"],
            }
        )

    OUT.write_text(json.dumps({"sites": sites}, separators=(",", ":")), encoding="utf-8")
    target = next(site for site in sites if site["rn"] == "RN102673530")
    print(f"sites {len(sites)} site {n_site} county {n_county} fallback {n_county_fallback} null {n_null}")
    print(f"bytes {OUT.stat().st_size}")
    print(json.dumps(target, indent=2))


if __name__ == "__main__":
    main()
