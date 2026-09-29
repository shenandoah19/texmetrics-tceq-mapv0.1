/* Agreed-order map or active-violation pins. One layer at a time. */
(function () {
  if (window.L && typeof L.map === "function" && !L.map.__texmetricsWrapped) {
    const origMap = L.map;
    const wrapped = function () {
      const map = origMap.apply(this, arguments);
      window.__texmetricsMap = map;
      return map;
    };
    wrapped.__texmetricsWrapped = true;
    L.map = wrapped;
  }

  const PIN = "#d45d4e";

  window.__texmetricsPopupOptions = function () {
    const map = window.__texmetricsMap;
    const height = map && map.getSize ? map.getSize().y : 480;
    return {
      maxWidth: 340,
      maxHeight: Math.max(160, Math.min(320, height - 88)),
      autoPan: true,
      keepInView: true,
      autoPanPaddingTopLeft: [24, 48],
      autoPanPaddingBottomRight: [24, 36],
    };
  };
  const LIST_CAP = 25;
  const EMPTY_KICKER = "Independent map of TCEQ public records";
  const SEARCH_KICKER = "Public TCEQ records. Not a TCEQ site.";
  const EMPTY_DETAIL =
    '<p class="kicker">Selected site</p><p class="meta" style="margin-top:8px">Click a pin to see every agreed order and violation count at that RN.</p>';
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const PAID_LABEL = "Open Data paid (payable + SEP)";
  const REPORT_NOTE = "The $129 report can include later Commission Issued Orders not in this file.";
  let citationsThroughIso = "2025-10-21";

  let mode = "orders";
  window.__texmetricsMode = "orders";
  let violationSites = [];
  let byRn = new Map();
  let activeLayer = null;
  let selectLayer = null;
  let activeRns = new Set();
  let selectedRn = "";
  let lockedRn = "";
  let lockedQuery = "";
  let listEl = null;
  let queryEl = null;

  function state() {
    return window.__texmetricsMapState || null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&#38;",
      "<": "&#60;",
      ">": "&#62;",
      '"': "&#34;",
      "'": "&#39;",
    }[ch]));
  }

  function countyLabel(county) {
    const raw = String(county || "").trim();
    if (!raw || raw === "*MULTIPLE") return raw === "*MULTIPLE" ? "Multiple counties" : "";
    const label = raw
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    return /county$/i.test(label) ? label : label + " County";
  }

  function finitePair(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return { lat: la, lon: lo };
  }

  function ordersByRn() {
    const orders = (state() && state().payload && state().payload.orders) || [];
    const map = new Map();
    for (let i = 0; i < orders.length; i++) {
      const rn = String(orders[i].rn || "").trim().toUpperCase();
      if (!rn) continue;
      if (!map.has(rn)) map.set(rn, []);
      map.get(rn).push(orders[i]);
    }
    return map;
  }

  function toIso(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!match) return "";
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const month = months[match[1].slice(0, 3).toLowerCase()];
    if (!month) return "";
    return match[3] + "-" + month + "-" + String(Number(match[2])).padStart(2, "0");
  }

  function yearSpan(filters) {
    const from = toIso(filters && filters.dateFrom).slice(0, 4);
    const to = toIso(filters && filters.dateTo).slice(0, 4);
    if (!/^\d{4}$/.test(from) || !/^\d{4}$/.test(to)) return "";
    return from + "–" + to;
  }

  function payableInWindow(orders, filters) {
    let sum = 0;
    const from = toIso(filters && filters.dateFrom);
    const to = toIso(filters && filters.dateTo);
    for (let i = 0; i < orders.length; i++) {
      const date = toIso(orders[i].orderDate);
      if (from && date && date < from) continue;
      if (to && date && date > to) continue;
      sum += Number(orders[i].payable) || 0;
    }
    return sum;
  }

  function formatDate(iso) {
    const [y, m, d] = String(toIso(iso) || "").split("-").map(Number);
    if (!y || !m || !d) return String(iso || "");
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  }

  let ordersThroughCached = "";
  function ordersThroughHtml() {
    if (ordersThroughCached) return ordersThroughCached;
    const orders = (state() && state().payload && state().payload.orders) || [];
    let latest = "";
    for (let i = 0; i < orders.length; i++) {
      const date = toIso(orders[i].orderDate);
      if (date && date > latest) latest = date;
    }
    if (!latest) return "";
    ordersThroughCached = '<p class="orders-through">' + escapeHtml("Open Data orders through " + formatDate(latest) + ".") + "</p>";
    return ordersThroughCached;
  }

  window.__texmetricsOrdersThroughHtml = ordersThroughHtml;

  function plainProgram(program) {
    const text = String(program || "").trim().toLowerCase();
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function orderLines(orders) {
    return orders.slice().sort((a, b) => String(toIso(b.orderDate)).localeCompare(String(toIso(a.orderDate))));
  }

  function orderLine(order) {
    return [formatDate(order.orderDate), money.format(Number(order.payable) || 0), plainProgram(order.program)]
      .filter(Boolean)
      .join(" · ");
  }

  const PROGRAM_WORDS = {
    PWS: "Public water system",
    WWPERMIT: "Wastewater",
    PSTREG: "Petroleum storage",
    AIROP: "Air quality",
    AIREI: "Air quality",
    AIRNSR: "Air quality",
    IHW: "Industrial waste",
    IHWCA: "Industrial waste",
    TIRES: "Tires",
    SDA: "Sludge",
    P2PLAN: "Pollution prevention",
  };

  function identityLine(rec) {
    const labels = [];
    const programs = Array.isArray(rec.programs) ? rec.programs : [];
    for (let i = 0; i < programs.length; i++) {
      const label = PROGRAM_WORDS[programs[i]];
      if (label && labels.indexOf(label) === -1) labels.push(label);
    }
    const bits = [];
    if (labels.length === 1) bits.push(labels[0]);
    if (rec.cn) bits.push(rec.cn);
    return bits.join(" · ");
  }

  function ratingLabel(rec) {
    const counts = {};
    const orders = rec.orders || [];
    for (let i = 0; i < orders.length; i++) {
      const key = orders[i].reClass || "";
      if (!key || key === "UNCLASSIFIED") continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (best === "HIGH") return "High";
    if (best === "SATISFACTORY") return "Satisfactory";
    if (best === "UNSATISFACTORY") return "Unsatisfactory";
    return "";
  }

  function payableAll(orders, viol) {
    let sum = 0;
    for (let i = 0; i < orders.length; i++) sum += Number(orders[i].payable) || 0;
    if (sum > 0) return sum;
    return Number(viol && viol.payable) || 0;
  }

  function pointFor(viol, orders) {
    if (viol && viol.loc === "site") {
      const pair = finitePair(viol.lat, viol.lon);
      if (pair) return { lat: pair.lat, lon: pair.lon, loc: "site" };
    }
    for (let i = 0; i < orders.length; i++) {
      if (orders[i].loc === "site") {
        const pair = finitePair(orders[i].lat, orders[i].lon);
        if (pair) return { lat: pair.lat, lon: pair.lon, loc: "site" };
      }
    }
    if (viol) {
      const pair = finitePair(viol.lat, viol.lon);
      if (pair) return { lat: pair.lat, lon: pair.lon, loc: viol.loc || "county" };
    }
    for (let i = 0; i < orders.length; i++) {
      const pair = finitePair(orders[i].lat, orders[i].lon);
      if (pair) return { lat: pair.lat, lon: pair.lon, loc: orders[i].loc || "county" };
    }
    return { lat: null, lon: null, loc: null };
  }

  const naicsLabels = new Map();
  let sitesReady = false;

  function parseNaics(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d+)\s*[-–—]\s*(.+)$/);
    if (!match) return null;
    const code = match[1];
    const desc = match[2].trim();
    if (!code || !desc) return null;
    return { code: code, desc: desc };
  }

  function installNaicsSelect() {
    if (!sitesReady) return;
    const select = document.getElementById("biz");
    if (!select || select.dataset.naicsReady === "1") return;
    const codes = Array.from(naicsLabels.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!codes.length) {
      select.hidden = true;
      select.dataset.naicsReady = "1";
      return;
    }
    const options = ['<option value="">All NAICS</option>'];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const label = code + " — " + naicsLabels.get(code);
      options.push('<option value="' + escapeHtml(code) + '">' + escapeHtml(label) + "</option>");
    }
    select.innerHTML = options.join("");
    select.setAttribute("aria-label", "NAICS");
    select.dataset.naicsReady = "1";
  }

  window.__texmetricsNaicsCode = function (order) {
    const rn = String((order && order.rn) || "").trim().toUpperCase();
    const site = byRn.get(rn);
    return (site && site.naicsCode) || "";
  };

  function titleName(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^RN\d{9}$/i.test(text)) return text.toUpperCase();
    const keep = { LLC: 1, LP: 1, INC: 1, CO: 1, US: 1, USA: 1, II: 1, III: 1, IV: 1, LTD: 1 };
    return text.split(/(\s+)/).map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      return part.split("-").map((word) => {
        const upper = word.toUpperCase();
        if (keep[upper]) return upper;
        if (/^RN\d+$/i.test(word)) return word.toUpperCase();
        const lower = word.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }).join("-");
    }).join("");
  }

  function allowSticky() {
    [document.documentElement, document.body, document.getElementById("app")].forEach((node) => {
      if (!node) return;
      node.style.overflowX = "clip";
      node.style.overflowY = "visible";
    });
  }

  function fitCard(el) {
    const box = el.getBoundingClientRect();
    const top = box.top < 16 ? 16 : box.top;
    el.style.maxHeight = Math.max(180, window.innerHeight - top - 12) + "px";
  }

  function keepCardOnScreen(el) {
    if (!el) return;
    allowSticky();
    el.style.position = "sticky";
    el.style.top = "16px";
    el.style.overflowY = "auto";
    el.style.zIndex = "3";
    const title = el.querySelector("h2");
    if (title) {
      title.style.whiteSpace = "normal";
      title.style.overflow = "visible";
    }
    fitCard(el);
    if (!window.__texmetricsCardFit) {
      window.__texmetricsCardFit = true;
      const refit = () => {
        const card = document.getElementById("detail");
        if (card && card.dataset.texmetricsCard === "1") fitCard(card);
      };
      window.addEventListener("scroll", refit, { passive: true });
      window.addEventListener("resize", refit);
    }
  }

  function keepPopupOnScreen(popup) {
    const map = (popup && popup._map) || window.__texmetricsMap;
    if (!map || !popup || !popup.getElement) return;
    const el = popup.getElement();
    if (!el) return;
    const title = el.querySelector("h3");
    if (title) {
      title.style.whiteSpace = "normal";
      title.style.overflow = "visible";
      title.style.textOverflow = "clip";
    }
    const mapRect = map.getContainer().getBoundingClientRect();
    const room = Math.max(160, mapRect.height - 28);
    const content = el.querySelector(".leaflet-popup-content");
    if (content) {
      content.style.maxHeight = room + "px";
      content.style.overflowY = "auto";
    }
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) {
      const waits = popup._texmetricsWait || 0;
      if (waits < 8) {
        popup._texmetricsWait = waits + 1;
        requestAnimationFrame(() => keepPopupOnScreen(popup));
      }
      return;
    }
    const fitWidth = Math.max(180, Math.min(340, Math.floor(mapRect.width - 48)));
    if (!popup._texmetricsWidthFit && fitWidth < (Number(popup.options.maxWidth) || 341)) {
      popup._texmetricsWidthFit = true;
      popup.options.maxWidth = fitWidth;
      popup.update();
      requestAnimationFrame(() => keepPopupOnScreen(popup));
      return;
    }
    const pad = 12;
    let dx = 0;
    let dy = 0;
    if (box.top < mapRect.top + pad) dy = -((mapRect.top + pad) - box.top);
    else if (box.bottom > mapRect.bottom - pad && box.height <= room) dy = -(box.bottom - (mapRect.bottom - pad));
    if (box.left < mapRect.left + pad) dx = -((mapRect.left + pad) - box.left);
    else if (box.right > mapRect.right - pad) dx = -(box.right - (mapRect.right - pad));
    const pans = popup._texmetricsPanCount || 0;
    if ((dx || dy) && pans < 2) {
      popup._texmetricsPanCount = pans + 1;
      map.panBy([dx, dy], { animate: false });
      requestAnimationFrame(() => keepPopupOnScreen(popup));
      return;
    }
    if (box.top < mapRect.top + pad && !popup._texmetricsBelow) {
      const height = el.offsetHeight || box.height || 220;
      const offset = popup.options.offset || [0, 7];
      const ox = Array.isArray(offset) ? Number(offset[0]) || 0 : Number(offset.x) || 0;
      const oy = Array.isArray(offset) ? Number(offset[1]) || 0 : Number(offset.y) || 0;
      popup._texmetricsBelow = true;
      popup.options.offset = [ox, oy + height + 18];
      popup.update();
      requestAnimationFrame(() => keepPopupOnScreen(popup));
    }
  }
  window.__texmetricsKeepPopupOnScreen = keepPopupOnScreen;

  function watchPopups() {
    const map = window.__texmetricsMap;
    if (!map || map.__texmetricsPopupWatch) return;
    map.__texmetricsPopupWatch = true;
    map.on("popupopen", (event) => {
      requestAnimationFrame(() => keepPopupOnScreen(event.popup));
    });
  }

  function buildRecord(rn, viol, orders) {
    const point = pointFor(viol, orders || []);
    const first = (orders && orders[0]) || {};
    const name = (viol && viol.name) || first.siteName || first.reName || first.customer || rn;
    const county = (viol && viol.county) || first.county || "";
    const orderCounties = [];
    for (let i = 0; i < (orders || []).length; i++) {
      if (orders[i].county && orderCounties.indexOf(orders[i].county) === -1) orderCounties.push(orders[i].county);
    }
    return {
      rn: rn,
      name: name,
      customer: (viol && viol.customer) || first.customer || "",
      naicsCode: (viol && viol.naicsCode) || "",
      county: county,
      orderCounties: orderCounties,
      city: (viol && viol.city) || first.city || "",
      address: (viol && viol.address) || first.address || "",
      cn: (viol && viol.cn) || "",
      programs: (viol && viol.programs) || [],
      violActive: viol ? Number(viol.violActive) || 0 : Number(first.violActive) || 0,
      violRepeat: viol ? Number(viol.violRepeat) || 0 : Number(first.violRepeat) || 0,
      lat: point.lat,
      lon: point.lon,
      loc: point.loc,
      orders: orders || [],
      payableAll: payableAll(orders || [], viol),
    };
  }

  function records() {
    const grouped = ordersByRn();
    const map = new Map();
    byRn.forEach((viol, rn) => {
      map.set(rn, buildRecord(rn, viol, grouped.get(rn) || []));
    });
    grouped.forEach((orders, rn) => {
      if (!map.has(rn)) map.set(rn, buildRecord(rn, null, orders));
    });
    return map;
  }

  function filtersNow() {
    const current = state();
    return (current && current.filters) || {};
  }

  function inWindow(rec) {
    return payableInWindow(rec.orders, filtersNow());
  }

  function exactRnQuery(query) {
    return /^RN\d{9}$/i.test(String(query || "").trim());
  }

  function matchesQuery(rec, q) {
    const hay = [rec.name, rec.rn, rec.county, countyLabel(rec.county), rec.customer, rec.city, rec.address]
      .join("\n")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function passesFilters(rec, query) {
    const filters = filtersNow();
    if (exactRnQuery(query) && rec.rn === query.trim().toUpperCase()) return true;
    const county = filters.county || "";
    if (county) {
      const wanted = county.toUpperCase();
      const own = String(rec.county || "").toUpperCase() === wanted;
      const any = rec.orderCounties.some((item) => String(item).toUpperCase() === wanted);
      if (!own && !any) return false;
    }
    const min = Number(filters.minPayable) || 0;
    if (min && inWindow(rec) < min) return false;
    return true;
  }

  function search(query) {
    const q = query.toLowerCase();
    const hits = [];
    records().forEach((rec) => {
      if (!matchesQuery(rec, q)) return;
      if (!passesFilters(rec, query)) return;
      hits.push(rec);
    });
    hits.sort((a, b) => inWindow(b) - inWindow(a) || b.violActive - a.violActive || a.name.localeCompare(b.name));
    return hits;
  }

  function citationsThroughText() {
    return formatDate(citationsThroughIso || "2025-10-21");
  }

  function listedActive(count) {
    return (Number(count) || 0).toLocaleString() + " listed as active in the citations extract through " + citationsThroughText() + ".";
  }

  function figureText(rec) {
    const payable = inWindow(rec);
    if (payable > 0) return money.format(payable);
    return listedActive(rec.violActive);
  }

  function violationsLine(rec) {
    const bits = [listedActive(rec.violActive)];
    if (rec.violRepeat) bits.push(rec.violRepeat + " repeat");
    return bits.join(" ");
  }

  function reportHtml(rn) {
    const label = rn === "RN100209931"
      ? "Get the TexMetrics report for this site"
      : "Get the TexMetrics report for this site · $129";
    return (
      '<button type="button" class="report-cta-button" id="reportCta" data-rn="' +
      escapeHtml(rn) +
      '">' +
      label +
      "</button>" +
      '<p class="cta-disclaimer">Public TCEQ compilation. Not a Phase I. Not a TCEQ company rating. Not legal advice.</p>'
    );
  }

  function enforcementHtml(rec, limit) {
    const orders = orderLines(rec.orders || []);
    const shown = orders.slice(0, limit);
    if (!shown.length) return "";
    const items = shown.map((order) => "<li>" + escapeHtml(orderLine(order)) + "</li>").join("");
    const more = orders.length > limit ? '<p class="meta">The rest are on the report.</p>' : "";
    return '<ol class="order-list">' + items + "</ol>" + more;
  }

  function paintCard(rec) {
    const el = document.getElementById("detail");
    if (!el || !rec) return;
    const payable = inWindow(rec);
    const outside = payable <= 0 && rec.payableAll > 0;
    const county = countyLabel(rec.county);
    const rnLine = [rec.rn, county].filter(Boolean).join(" · ");
    const identity = identityLine(rec);
    const rating = ratingLabel(rec);
    const where = rec.loc === "county"
      ? '<p class="meta">Plotted at the county center. Facility coordinates were not in the extract.</p>'
      : "";
    let penalty = "";
    if (outside) penalty = '<p class="meta">' + escapeHtml(money.format(rec.payableAll) + " outside the selected years.") + "</p>";
    else if (rec.payableAll <= 0) penalty = '<p class="meta">No agreed-order penalty in this extract.</p>';
    const repeat = rec.violRepeat ? '<p class="meta">' + escapeHtml(rec.violRepeat + " repeat") + "</p>" : "";
    el.classList.remove("dash");
    el.dataset.siteRn = rec.rn;
    el.dataset.texmetricsCard = "1";
    el.innerHTML =
      "<h2>" + escapeHtml(rec.name) + "</h2>" +
      '<p class="amount">' + escapeHtml(money.format(payable)) + "</p>" +
      '<p class="meta">' + escapeHtml(PAID_LABEL) + "</p>" +
      '<p class="meta">' + escapeHtml(REPORT_NOTE) + "</p>" +
      ordersThroughHtml() +
      '<p class="meta">' + escapeHtml(listedActive(rec.violActive)) + "</p>" +
      repeat +
      (rating ? '<p class="meta">' + escapeHtml(rating) + "</p>" : "") +
      enforcementHtml(rec, 3) +
      penalty +
      '<p class="meta">' + escapeHtml(rnLine) + "</p>" +
      (identity ? '<p class="meta">' + escapeHtml(identity) + "</p>" : "") +
      where +
      '<div class="report-cta">' + reportHtml(rec.rn) + "</div>";
    keepCardOnScreen(el);
    el.scrollTop = 0;
    const btn = document.getElementById("reportCta");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.__texmetricsOpenReport === "function") window.__texmetricsOpenReport(rec.rn);
      });
    }
  }

  function popupHtml(rec) {
    const orders = orderLines(rec.orders || []);
    const shown = orders.slice(0, 8);
    const items = shown.map((order) => "<li>" + escapeHtml(orderLine(order)) + "</li>").join("");
    const more = orders.length > 8 ? "<li>+" + (orders.length - 8) + " more agreed orders</li>" : "";
    const payable = inWindow(rec);
    const place = [rec.address, rec.city, countyLabel(rec.county)].filter(Boolean).join(", ");
    const rating = ratingLabel(rec) || "Unclassified";
    const label = rec.rn === "RN100209931"
      ? "Get the TexMetrics report for this site"
      : "Get the TexMetrics report for this site · $129";
    return (
      '<div class="order-popup"><h3>' + escapeHtml(rec.name) + "</h3>" +
      (rec.customer && rec.customer !== rec.name ? '<p class="site">' + escapeHtml(rec.customer) + "</p>" : "") +
      "<dl>" +
      '<div><dt>' + escapeHtml(PAID_LABEL) + "</dt><dd class=\"amount\">" + escapeHtml(money.format(payable)) + "</dd></div>" +
      ordersThroughHtml() +
      "<div><dt>Orders</dt><dd>" + orders.length + " at this RN</dd></div>" +
      "<div><dt>RN</dt><dd>" + escapeHtml(rec.rn) + "</dd></div>" +
      "<div><dt>Rating</dt><dd>" + escapeHtml(rating) + "</dd></div>" +
      "<div><dt>Place</dt><dd>" + escapeHtml(place) + "</dd></div>" +
      "<div><dt>Violations</dt><dd>" + escapeHtml(violationsLine(rec)) + "</dd></div>" +
      "</dl>" +
      '<button type="button" class="report-cta-button popup-cta" data-rn="' + escapeHtml(rec.rn) + '">' + label + "</button>" +
      '<p class="cta-disclaimer">Public TCEQ compilation. Not a Phase I. Not a TCEQ company rating. Not legal advice.</p>' +
      '<ol class="order-list">' + items + more + "</ol></div>"
    );
  }

  window.__texmetricsPaintCard = function (site) {
    if (!site) return;
    const rn = String(site.rn || "").trim().toUpperCase();
    if (!rn) return;
    const rec = records().get(rn) || buildRecord(rn, byRn.get(rn) || null, site.orders || []);
    selectedRn = rn;
    paintCard(rec);
    showSelectPin(rec);
  };

  function restorePlaceholder() {
    const el = document.getElementById("detail");
    if (!el || el.dataset.texmetricsCard !== "1") return;
    el.classList.add("dash");
    el.innerHTML = EMPTY_DETAIL;
    delete el.dataset.siteRn;
    delete el.dataset.texmetricsCard;
  }

  function mapObj() {
    return (state() && state().map) || window.__texmetricsMap || null;
  }

  function svgRenderer(paneName, zIndex) {
    const map = mapObj();
    if (!map || !window.L) return null;
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = String(zIndex);
    }
    if (!svgRenderer.cache) svgRenderer.cache = {};
    if (!svgRenderer.cache[paneName]) svgRenderer.cache[paneName] = L.svg({ pane: paneName });
    return svgRenderer.cache[paneName];
  }

  function ensureActiveLayer() {
    const map = mapObj();
    if (!map || !window.L) return null;
    if (!activeLayer) activeLayer = L.layerGroup().addTo(map);
    return activeLayer;
  }

  function ensureSelectLayer() {
    const map = mapObj();
    if (!map || !window.L) return null;
    if (!selectLayer) selectLayer = L.layerGroup().addTo(map);
    return selectLayer;
  }

  function clearSelectPin() {
    if (selectLayer) selectLayer.clearLayers();
  }

  function activeRadius(count) {
    const n = Math.max(Number(count) || 1, 1);
    const t = Math.min(Math.log(n) / Math.log(50), 1.35);
    return Math.min(16, 4 + t * 10);
  }

  function payableTotal(rec) {
    return inWindow(rec);
  }

  function ordersInSpan(rec, filters) {
    const from = toIso(filters.dateFrom);
    const to = toIso(filters.dateTo);
    return (rec.orders || []).filter((order) => {
      const date = toIso(order.orderDate);
      if (from && (!date || date < from)) return false;
      if (to && (!date || date > to)) return false;
      return true;
    });
  }

  function passesActiveFilters(rec) {
    if (!(Number(rec.violActive) > 0)) return false;
    if (!finitePair(rec.lat, rec.lon)) return false;
    const filters = filtersNow();
    if (payableTotal(rec) < (Number(filters.minPayable) || 0)) return false;
    const county = String(filters.county || "").toUpperCase();
    if (county) {
      const own = String(rec.county || "").toUpperCase() === county;
      const any = (rec.orderCounties || []).some((item) => String(item).toUpperCase() === county);
      if (!own && !any) return false;
    }
    const orders = rec.orders || [];
    const ranged = ordersInSpan(rec, filters);
    if (orders.length && !ranged.length) return false;
    if (filters.biz && (rec.naicsCode || "") !== filters.biz) return false;
    if (filters.program || filters.reClass) {
      const hit = ranged.some((order) => {
        if (filters.program && order.program !== filters.program) return false;
        if (filters.reClass && (order.reClass || "UNCLASSIFIED") !== filters.reClass) return false;
        return true;
      });
      if (!hit) return false;
    }
    return true;
  }

  function activeSites() {
    const rows = [];
    records().forEach((rec) => {
      if (passesActiveFilters(rec)) rows.push(rec);
    });
    return rows;
  }

  function drawActiveLayer() {
    const layer = ensureActiveLayer();
    const map = mapObj();
    if (!layer || !map) return;
    const current = state();
    if (current && current.layer) current.layer.clearLayers();
    if (current && current.markersByKey) current.markersByKey.clear();
    layer.clearLayers();
    const rows = activeSites();
    activeRns = new Set();
    const catalog = records();
    for (let i = 0; i < rows.length; i++) {
      const site = rows[i];
      const pair = finitePair(site.lat, site.lon);
      const rec = catalog.get(site.rn);
      activeRns.add(site.rn);
      const marker = L.circleMarker([pair.lat, pair.lon], {
        renderer: svgRenderer("activePins", 640),
        pane: "activePins",
        radius: activeRadius(site.violActive),
        color: PIN,
        weight: 1,
        fillColor: PIN,
        fillOpacity: 0.85,
        opacity: 1,
      });
      if (rec) {
        marker.bindPopup(popupHtml(rec), window.__texmetricsPopupOptions());
        marker.on("click", () => {
          choose(rec, false);
          marker.openPopup();
        });
      }
      marker.addTo(layer);
    }
  }

  function clearActiveLayer() {
    activeRns = new Set();
    if (activeLayer) activeLayer.clearLayers();
  }

  function onLayer(rn) {
    if (mode === "active") return activeRns.has(rn);
    const current = state();
    if (!current || !current.markersByKey) return false;
    return current.markersByKey.has(rn);
  }

  function flyTo(lat, lon) {
    const map = mapObj();
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const zoom = Math.max(map.getZoom(), 9);
    map.flyTo([lat, lon], zoom, { duration: 0.55 });
  }

  function showSelectPin(rec) {
    if (!rec || !Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) {
      clearSelectPin();
      return;
    }
    const searching = queryEl && queryEl.value.trim();
    const orangeOnRed = mode === "active" && !!searching;
    if (!orangeOnRed && onLayer(rec.rn)) {
      clearSelectPin();
      return;
    }
    const layer = ensureSelectLayer();
    const map = mapObj();
    if (!layer || !map) return;
    layer.clearLayers();
    layer.addTo(map);
    L.circleMarker([rec.lat, rec.lon], {
      renderer: svgRenderer("selectPins", 660),
      pane: "selectPins",
      radius: Math.max(8, activeRadius(rec.violActive || 1)),
      color: "#c96a4a",
      weight: 2,
      fillColor: "#c96a4a",
      fillOpacity: 0.95,
      opacity: 1,
    }).addTo(layer);
  }

  function choose(rec, fly) {
    if (!rec) return;
    selectedRn = rec.rn;
    lockedRn = rec.rn;
    paintCard(rec);
    showSelectPin(rec);
    if (fly !== false) flyTo(rec.lat, rec.lon);
    paintList(lastMatches);
  }

  function ensureList() {
    if (listEl && listEl.isConnected) return listEl;
    const row = document.querySelector(".search-row");
    if (!row) return null;
    const list = document.createElement("ol");
    list.id = "violHits";
    list.className = "viol-hits";
    list.hidden = true;
    row.insertAdjacentElement("afterend", list);
    list.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-rn]");
      if (!btn) return;
      const rec = records().get(btn.getAttribute("data-rn"));
      if (!rec) return;
      lockedQuery = (queryEl && queryEl.value.trim().toLowerCase()) || "";
      choose(rec, true);
    });
    listEl = list;
    return list;
  }

  let lastMatches = [];

  function paintList(matches) {
    const list = ensureList();
    if (!list) return;
    const shown = matches.slice(0, LIST_CAP);
    if (!shown.length) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    list.hidden = false;
    list.innerHTML = shown
      .map((rec) => {
        const on = rec.rn === selectedRn ? " on" : "";
        const county = countyLabel(rec.county);
        return (
          '<li><button type="button" class="viol-hit' + on + '" data-rn="' + escapeHtml(rec.rn) + '">' +
          '<div class="name">' + escapeHtml(rec.name) + "</div>" +
          '<p class="meta">' + escapeHtml([rec.rn, county, figureText(rec)].filter(Boolean).join(" · ")) + "</p>" +
          "</button></li>"
        );
      })
      .join("");
  }

  function pageKicker() {
    return document.querySelector("header .mast .kicker");
  }

  function rankCard() {
    const title = document.getElementById("rankTitle");
    return title ? title.closest("section") : null;
  }

  function setSearchChrome(searching) {
    const kicker = pageKicker();
    if (kicker) kicker.textContent = searching ? SEARCH_KICKER : EMPTY_KICKER;
    const stats = document.getElementById("stats");
    if (stats) stats.hidden = !!searching;
    const card = rankCard();
    if (card) card.hidden = !!searching;
  }

  function legendEl() {
    return document.querySelector(".legend");
  }

  function restoreAgreedChrome() {
    const legend = legendEl();
    if (legend) {
      legend.innerHTML = '<p class="kicker">One pin per RN</p><p>Size = Open Data paid at site</p><p>Glow = $100k+ · ring = rating</p>';
    }
    const card = rankCard();
    const kicker = document.getElementById("rankKicker");
    if (kicker) kicker.textContent = "Ranked by Open Data paid";
    const lede = document.querySelector("header .lede");
    if (lede) lede.textContent = "One pin per facility RN. Size is total payable at that site. Glow marks $100,000 or more. Ring color is compliance rating.";
  }

  function paintActiveChrome(rows) {
    const legend = legendEl();
    if (legend) {
      legend.innerHTML = '<p class="kicker">One pin per site</p><p>' + escapeHtml("Size = listed as active in the citations extract through " + citationsThroughText() + ". Not a fine.") + "</p>";
    }
    const lede = document.querySelector("header .lede");
    if (lede) lede.textContent = "Size = listed as active in the citations extract through " + citationsThroughText() + ". Not a fine.";
    let sitesN = 0;
    let activeN = 0;
    const counties = new Set();
    for (let i = 0; i < rows.length; i++) {
      sitesN += 1;
      activeN += Number(rows[i].violActive) || 0;
      if (rows[i].county) counties.add(rows[i].county);
    }
    const filters = filtersNow();
    const stats = document.getElementById("stats");
    if (stats && !stats.hidden) {
      stats.innerHTML =
        '<div class="stat"><dt>Sites</dt><dd>' + sitesN.toLocaleString() + "</dd><p>" + escapeHtml("Citations extract through " + citationsThroughText() + ".") + "</p></div>" +
        '<div class="stat"><dt>Citations</dt><dd>' + escapeHtml(listedActive(activeN)) + "</dd><p>Not a fine.</p></div>" +
        '<div class="stat"><dt>Date span</dt><dd>' + escapeHtml(yearSpan(filters)) + "</dd><p>Selected range</p></div>" +
        '<div class="stat"><dt>Counties</dt><dd>' + counties.size.toLocaleString() + "</dd><p>Sites on this layer</p></div>";
    }
    const card = rankCard();
    if (!card || card.hidden) return;
    const kicker = document.getElementById("rankKicker");
    if (kicker) kicker.textContent = "Ranked by listed as active";
    const ranked = rows.slice().sort((a, b) => (Number(b.violActive) || 0) - (Number(a.violActive) || 0));
    const limit = Number(filters.topLimit) || 10;
    const top = ranked.slice(0, limit);
    const max = top.length ? Number(top[0].violActive) || 1 : 1;
    const rank = document.getElementById("rank");
    const title = document.getElementById("rankTitle");
    if (title) title.textContent = "Top " + limit + " sites";
    if (!rank) return;
    rank.innerHTML = top.map((site, i) => {
      const on = site.rn === selectedRn ? " on" : "";
      const count = Number(site.violActive) || 0;
      return (
        '<li><button type="button" class="rank-row' + on + '" data-active-rn="' + escapeHtml(site.rn) + '">' +
        '<div class="rank-top"><span>' + (i + 1) + " " + escapeHtml(site.name) + "</span><b>" + escapeHtml(listedActive(count)) + "</b></div>" +
        '<div class="bar"><i style="width:' + Math.max(8, (count / max) * 100) + '%"></i></div>' +
        '<p class="meta">' + escapeHtml(site.rn) + " · " + escapeHtml(countyLabel(site.county)) + "</p>" +
        "</button></li>"
      );
    }).join("") || '<p class="meta">' + escapeHtml("None listed as active in the citations extract through " + citationsThroughText() + ".") + "</p>";
  }

  function paintToggle() {
    const host = document.getElementById("viols");
    if (!host) return;
    host.innerHTML =
      '<div class="mode-toggle" role="group" aria-label="Map layer">' +
      '<button type="button" data-mode="orders"' + (mode === "orders" ? ' class="on"' : "") + ">Agreed orders</button>" +
      '<button type="button" data-mode="active"' + (mode === "active" ? ' class="on"' : "") + ">Listed as active</button>" +
      "</div>";
  }

  function syncSearch(fly) {
    if (!queryEl) return;
    const query = queryEl.value.trim();
    const key = query.toLowerCase();
    if (!query) {
      lockedRn = "";
      lockedQuery = "";
      lastMatches = [];
      paintList([]);
      clearSelectPin();
      selectedRn = "";
      setSearchChrome(false);
      restorePlaceholder();
      return;
    }
    if (key !== lockedQuery) lockedRn = "";
    const hits = search(query);
    lastMatches = hits;
    let picked = null;
    if (hits.length === 1) picked = hits[0];
    else if (lockedRn) picked = hits.find((rec) => rec.rn === lockedRn) || null;
    selectedRn = picked ? picked.rn : "";
    paintList(hits);
    setSearchChrome(hits.length > 0);
    if (picked) {
      paintCard(picked);
      showSelectPin(picked);
      if (fly) flyTo(picked.lat, picked.lon);
    } else {
      clearSelectPin();
      restorePlaceholder();
    }
  }

  function afterRender() {
    paintToggle();
    const query = queryEl && queryEl.value.trim();
    if (query) syncSearch(false);
    const searching = !!(query && lastMatches.length);
    if (!searching) setSearchChrome(false);
    if (mode === "active") {
      drawActiveLayer();
      if (!searching) paintActiveChrome(activeSites());
    } else {
      clearActiveLayer();
      if (!searching) restoreAgreedChrome();
    }
    if (!query && selectedRn) {
      const rec = records().get(selectedRn);
      if (rec) paintCard(rec);
    }
    const selected = selectedRn ? records().get(selectedRn) : null;
    const queryText = queryEl && queryEl.value.trim();
    if (selected && (queryText || onLayer(selected.rn))) showSelectPin(selected);
    else if (!queryText) clearSelectPin();
  }

  window.__texmetricsAfterRender = afterRender;

  function boot() {
    const started = Date.now();
    function tick() {
      queryEl = document.getElementById("query");
      const ready = state() && queryEl && document.getElementById("viols") && document.getElementById("stats");
      if (ready) {
        allowSticky();
        installNaicsSelect();
        watchPopups();
        ensureList();
        document.getElementById("viols").addEventListener("click", (event) => {
          const btn = event.target.closest("[data-mode]");
          if (!btn || btn.getAttribute("data-mode") === mode) return;
          mode = btn.getAttribute("data-mode");
          window.__texmetricsMode = mode;
          const current = state();
          if (current && typeof current.render === "function") current.render();
          else afterRender();
        });
        const rank = document.getElementById("rank");
        if (rank) {
          rank.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-active-rn]");
            if (!btn) return;
            const rec = records().get(btn.getAttribute("data-active-rn"));
            if (rec) choose(rec, true);
          });
        }
        queryEl.addEventListener("input", () => syncSearch(true));
        afterRender();
        syncSearch(true);
        return;
      }
      if (Date.now() - started > 30000) return;
      requestAnimationFrame(tick);
    }
    tick();
  }

  function loadSites() {
    const page = location.pathname.endsWith(".html")
      ? location.pathname.replace(/[^/]+$/, "")
      : location.pathname.endsWith("/")
        ? location.pathname
        : location.pathname + "/";
    const urls = [
      location.origin + page + "violation-sites.json",
      "./violation-sites.json",
      "https://shenandoah19.github.io/texmetrics-tceq-mapv0.1/violation-sites.json",
    ];
    const seen = new Set();
    const chain = urls.reduce((promise, url) => {
      return promise.catch(() => {
        if (seen.has(url)) throw new Error("skip");
        seen.add(url);
        return fetch(url, { cache: "no-store" }).then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        });
      });
    }, Promise.reject());
    return chain.then((payload) => {
      const through = payload && payload.meta && payload.meta.citationsThrough;
      if (through) citationsThroughIso = String(through);
      const rows = Array.isArray(payload) ? payload : payload.sites || [];
      violationSites = rows.filter((site) => site && site.rn);
      byRn = new Map();
      violationSites.forEach((site) => {
        site.rn = String(site.rn).trim().toUpperCase();
        site.name = titleName(site.name);
        site.customer = titleName(site.customer);
        const parsed = parseNaics(site.naics);
        site.naicsCode = parsed ? parsed.code : "";
        if (parsed && !naicsLabels.has(parsed.code)) naicsLabels.set(parsed.code, parsed.desc);
        if (!Array.isArray(site.programs)) site.programs = [];
        byRn.set(site.rn, site);
      });
      sitesReady = true;
      installNaicsSelect();
      if (mode === "active") afterRender();
      syncSearch();
    });
  }

  loadSites().catch(() => {});
  boot();
})();
