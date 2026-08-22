/* TexMetrics TCEQ Agreed Orders — static GitHub Pages app */

const DATE_PRESETS = [
  { id: "all", label: "All years", years: null },
  { id: "10y", label: "10 years", years: 10 },
  { id: "5y", label: "5 years", years: 5 },
  { id: "2y", label: "2 years", years: 2 },
];

const AMOUNT_PRESETS = [
  { label: "Any amount", value: 0 },
  { label: "$5,000+", value: 5000 },
  { label: "$25,000+", value: 25000 },
  { label: "$100,000+", value: 100000 },
  { label: "$250,000+", value: 250000 },
];

const COMPLIANCE_RING = {
  HIGH: "#3d9a6a",
  SATISFACTORY: "#c4a35a",
  UNSATISFACTORY: "#d45d4e",
  UNCLASSIFIED: "#c96a4a",
};
const CLASS_LABEL = {
  HIGH: "High",
  SATISFACTORY: "Satisfactory",
  UNSATISFACTORY: "Unsatisfactory",
  UNCLASSIFIED: "Unclassified",
};
const HALO_MIN = 100000;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

function yearsAgo(n) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function applyPreset(id, dateMin, dateMax) {
  if (id === "all") return { dateFrom: dateMin || "", dateTo: dateMax || "" };
  const preset = DATE_PRESETS.find((p) => p.id === id);
  const from = yearsAgo(preset.years);
  return { dateFrom: dateMin && from < dateMin ? dateMin : from, dateTo: dateMax || "" };
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&#38;", "<": "&#60;", ">": "&#62;", '"': "&#34;", "'": "&#39;",
  })[ch]);
}

function bubbleRadius(payable, maxPayable) {
  const t = Math.sqrt(Math.max(payable, 0) / Math.max(maxPayable, 1));
  return 2.6 + t * 9.9;
}

function filterOrders(orders, filters) {
  const q = filters.query.trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.program && order.program !== filters.program) return false;
    if (filters.county && order.county !== filters.county) return false;
    if (filters.reClass && (order.reClass || "UNCLASSIFIED") !== filters.reClass) return false;
    if (filters.biz && (order.biz || "Unknown") !== filters.biz) return false;
    if (filters.hasActive && !(order.violActive)) return false;
    if (filters.hasRepeat && !(order.violRepeat)) return false;
    if (filters.hasMajor && !(order.violMajor)) return false;
    if (order.payable < filters.minPayable) return false;
    if (filters.customer && order.customer !== filters.customer) return false;
    if (filters.dateFrom && order.orderDate < filters.dateFrom) return false;
    if (filters.dateTo && order.orderDate > filters.dateTo) return false;
    if (!q) return true;
    return (
      order.customer.toLowerCase().includes(q) ||
      order.county.toLowerCase().includes(q) ||
      order.caseNo.toLowerCase().includes(q) ||
      order.docket.toLowerCase().includes(q) ||
      (order.rn || "").toLowerCase().includes(q) ||
      (order.siteName || "").toLowerCase().includes(q) ||
      (order.reName || "").toLowerCase().includes(q) ||
      (order.address || "").toLowerCase().includes(q) ||
      (order.city || "").toLowerCase().includes(q) ||
      order.program.toLowerCase().includes(q)
    );
  });
}

function topCustomers(orders, limit = 5) {
  const map = new Map();
  for (const order of orders) {
    const row = map.get(order.customer);
    if (row) { row.total += order.payable; row.count += 1; }
    else map.set(order.customer, { customer: order.customer, total: order.payable, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

function groupSites(orders) {
  const buckets = new Map();
  for (const order of orders) {
    const rn = (order.rn || "").trim().toUpperCase();
    const key = rn || `NORN:${order.caseNo}:${order.docket}`;
    const list = buckets.get(key);
    if (list) list.push(order);
    else buckets.set(key, [order]);
  }
  const sites = [];
  for (const [key, list] of buckets) {
    list.sort((a, b) => b.orderDate.localeCompare(a.orderDate));
    const siteRows = list.filter((order) => order.loc === "site");
    const src = siteRows.length ? siteRows : list;
    const lon = src.reduce((sum, order) => sum + order.lon, 0) / src.length;
    const lat = src.reduce((sum, order) => sum + order.lat, 0) / src.length;
    const payByCust = new Map();
    for (const order of list) payByCust.set(order.customer, (payByCust.get(order.customer) || 0) + order.payable);
    const customers = [...payByCust.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const first = list[0];
    sites.push({
      rn: key.startsWith("NORN:") ? "" : key,
      lon, lat,
      loc: siteRows.length ? "site" : "county",
      customer: customers[0] || first.customer,
      customers,
      siteName: (list.find((order) => order.siteName) || {}).siteName || (list.find((order) => order.reName) || {}).reName || "",
      address: (list.find((order) => order.address) || {}).address || "",
      city: (list.find((order) => order.city) || {}).city || "",
      county: first.county,
      reClass: first.reClass || "UNCLASSIFIED",
      biz: (list.find((order) => order.biz && order.biz !== "Unknown") || first).biz || "Unknown",
      payable: list.reduce((sum, order) => sum + order.payable, 0),
      count: list.length,
      violTotal: first.violTotal || 0,
      violActive: first.violActive || 0,
      violRepeat: first.violRepeat || 0,
      violMajor: first.violMajor || 0,
      orders: list,
    });
  }
  const cells = new Map();
  for (const site of sites) {
    const cell = `${site.lon.toFixed(4)},${site.lat.toFixed(4)}`;
    const group = cells.get(cell);
    if (group) group.push(site);
    else cells.set(cell, [site]);
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const group of cells.values()) {
    if (group.length < 2) continue;
    group.forEach((site, index) => {
      const radius = 0.004 + 0.003 * Math.sqrt(index);
      site.lon += radius * Math.cos(index * golden);
      site.lat += radius * Math.sin(index * golden);
    });
  }
  return sites;
}

function violLine(site) {
  const total = site.violTotal || 0;
  if (!total) return "None in extract";
  const bits = [`${total.toLocaleString()} total`];
  if (site.violActive) bits.push(`${site.violActive} active`);
  if (site.violRepeat) bits.push(`${site.violRepeat} repeat`);
  if (site.violMajor) bits.push(`${site.violMajor} major`);
  return bits.join(" · ");
}

function popupHtml(site) {
  const title = site.siteName && site.siteName !== site.customer ? site.siteName : site.customer;
  const place = [site.address, site.city, site.county].filter(Boolean).join(", ");
  const items = site.orders.slice(0, 8).map((order) =>
    `<li>${escapeHtml(formatDate(order.orderDate))} · ${escapeHtml(money.format(order.payable))} · ${escapeHtml(order.program)}</li>`
  ).join("");
  const more = site.count > 8 ? `<li>+${site.count - 8} more agreed orders</li>` : "";
  return `<div class="order-popup"><h3>${escapeHtml(title)}</h3>
    ${title !== site.customer ? `<p class="site">${escapeHtml(site.customer)}</p>` : ""}
    <dl>
    <div><dt>Payable</dt><dd class="amount">${escapeHtml(money.format(site.payable))}</dd></div>
    <div><dt>Orders</dt><dd>${site.count} at this RN</dd></div>
    <div><dt>RN</dt><dd>${site.rn ? escapeHtml(site.rn) : "Not in source file"}</dd></div>
    <div><dt>Rating</dt><dd>${escapeHtml(CLASS_LABEL[site.reClass] || "Unclassified")}</dd></div>
    <div><dt>Business</dt><dd>${escapeHtml(site.biz || "Unknown")}</dd></div>
    <div><dt>Place</dt><dd>${escapeHtml(place)}</dd></div>
    <div><dt>Location</dt><dd>${site.loc === "site" ? "Facility site" : "County center"}</dd></div>
    <div><dt>Violations</dt><dd>${escapeHtml(violLine(site))}</dd></div>
    </dl>
    <ol class="order-list">${items}${more}</ol>
  </div>`;
}

async function loadOrders() {
  const page = location.pathname.endsWith(".html")
    ? location.pathname.replace(/[^/]+$/, "")
    : location.pathname.endsWith("/")
      ? location.pathname
      : `${location.pathname}/`;
  const origin = location.origin;
  const candidates = [
    `${origin}${page}tceq-orders.json`,
    `${origin}${page}data/tceq-orders.json`,
    "./tceq-orders.json",
    "./data/tceq-orders.json",
    "https://shenandoah19.github.io/texmetrics-tceq-mapv0.1/tceq-orders.json",
  ];
  const seen = new Set();
  let last = "not found";
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      last = `${url} (${res.status})`;
    } catch (err) {
      last = `${url} (${err.message})`;
    }
  }
  throw new Error(`Could not load TCEQ orders data. ${last}`);
}

async function main() {
  const embed = document.documentElement.dataset.embed === "true";
  const payload = await loadOrders();
  const urlQuery = new URLSearchParams(location.search).get("q")?.trim() || "";

  const filters = {
    query: urlQuery,
    program: "",
    county: "",
    reClass: "",
    biz: "",
    hasActive: false,
    hasRepeat: false,
    hasMajor: false,
    minPayable: 0,
    customer: "",
    topLimit: 10,
    ...(urlQuery
      ? applyPreset("all", payload.meta.dateMin, payload.meta.dateMax)
      : applyPreset("5y", payload.meta.dateMin, payload.meta.dateMax)),
  };
  let focusedSearch = false;

  const startYear = Number((payload.meta.dateMin || "2015").slice(0, 4));
  const endYear = Number((payload.meta.dateMax || "2026").slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);

  const root = document.getElementById("app");
  root.innerHTML = `
    <header>
      <div class="mast">
        <img class="wordmark" src="./brand/wordmark.jpg" alt="TexMetrics" onerror="this.style.display='none'" />
        <div>
          <p class="kicker">Independent map of TCEQ public records</p>
          <h1>Agreed Orders</h1>
        </div>
      </div>
      ${embed ? "" : `<p class="lede">One pin per facility RN. Size is total payable at that site. Glow marks $100,000 or more. Ring color is compliance rating.</p>`}
      <dl class="stats" id="stats"></dl>
      <div class="filters">
        <details class="filter-fold" id="filterFold">
          <summary>Filters & search</summary>
        <div class="search-row">
          <label class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
            <input id="query" placeholder="Search customer, RN, site, case, or county" />
          </label>
          <div class="selects">
            <select id="program"><option value="">All programs</option>${payload.programs.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}</select>
            <select id="county"><option value="">All counties</option>${payload.counties.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="selects extra">
          <select id="reClass"><option value="">All ratings</option>${(payload.classes || ["HIGH","SATISFACTORY","UNSATISFACTORY","UNCLASSIFIED"]).map((c) => `<option value="${c}">${CLASS_LABEL[c] || c}</option>`).join("")}</select>
          <select id="biz"><option value="">All business types</option>${(payload.businessTypes || []).map((b) => `<option>${escapeHtml(b)}</option>`).join("")}</select>
        </div>
        <div class="chips" id="dates"></div>
        <div class="chips" id="amounts"></div>
        <div class="chips" id="viols"></div>
        </details>
      </div>
    </header>
    <div class="layout">
      <section class="map-wrap"><div id="map"></div>
        <div class="legend"><p class="kicker">One pin per RN</p><p>Size = total payable at site</p><p>Glow = $100k+ · ring = rating</p></div>
        <img class="shield" src="./brand/shield.jpg" alt="" onerror="this.style.display='none'" />
      </section>
      <aside>
        <section class="card"><p class="kicker">Ranked by payable</p>
          <div class="rank-head"><h2 id="rankTitle">Top 10 customers</h2>
            <div class="chips tight" id="topLimit"></div>
          </div>
          <ol class="rank" id="rank"></ol></section>
        <section class="card detail dash" id="detail"></section>
        <p class="note">Snapshot of publicly posted TCEQ agreed-order records processed by TexMetrics. One pin per RN; size is total payable (cash due to TCEQ). ${payload.meta.siteLocated ? `${payload.meta.siteLocated.toLocaleString()} orders have facility coordinates.` : ""} ${payload.meta.skippedCoords} records had missing coordinates and were not mapped.</p>
        <p class="note">TexMetrics is an independent company. This site is not affiliated with, endorsed by, or sponsored by the Texas Commission on Environmental Quality. Data is for information only and is not legal advice. Confirm official orders on the TCEQ Commission Issued Orders page.</p>
      </aside>
    </div>
  `;

  if (urlQuery) document.getElementById("query").value = urlQuery;

  const mobile = window.matchMedia("(max-width: 720px)").matches;
  const map = L.map("map", {
    center: [31.15, -99.35],
    zoom: mobile ? 5 : 6,
    minZoom: 5,
    maxZoom: 12,
    maxBounds: [[25.7, -106.7], [36.6, -93.4]],
    maxBoundsViscosity: 0.7,
    preferCanvas: true,
    zoomControl: false,
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  if (!mobile) document.getElementById("filterFold").open = true;
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 18,
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const resizeMap = () => map.invalidateSize();
  window.addEventListener("resize", resizeMap);
  window.addEventListener("orientationchange", resizeMap);
  requestAnimationFrame(resizeMap);
  setTimeout(resizeMap, 300);

  function activeDateId() {
    for (const preset of DATE_PRESETS) {
      const next = applyPreset(preset.id, payload.meta.dateMin, payload.meta.dateMax);
      if (next.dateFrom === filters.dateFrom && next.dateTo === filters.dateTo) return preset.id;
    }
    return "custom";
  }

  function drawChips() {
    const dateId = activeDateId();
    document.getElementById("dates").innerHTML = DATE_PRESETS.map((preset) =>
      `<button class="chip${dateId === preset.id ? " on" : ""}" data-date="${preset.id}">${preset.label}</button>`
    ).join("") + `
      <label class="year">From
        <select id="fromYear">${years.map((y) => `<option ${String(y) === filters.dateFrom.slice(0, 4) ? "selected" : ""}>${y}</option>`).join("")}</select>
      </label>
      <label class="year">To
        <select id="toYear">${years.map((y) => `<option ${String(y) === (filters.dateTo || "").slice(0, 4) ? "selected" : ""}>${y}</option>`).join("")}</select>
      </label>`;

    document.getElementById("amounts").innerHTML = AMOUNT_PRESETS.map((preset) =>
      `<button class="chip${filters.minPayable === preset.value ? " on" : ""}" data-amt="${preset.value}">${preset.label}</button>`
    ).join("") + (filters.customer
      ? `<button class="chip on" data-clear="customer">${escapeHtml(filters.customer)} · Clear</button>`
      : "");

    document.getElementById("viols").innerHTML = `
      <button class="chip${filters.hasActive ? " on" : ""}" data-viol="hasActive">Active violations</button>
      <button class="chip${filters.hasRepeat ? " on" : ""}" data-viol="hasRepeat">Repeats</button>
      <button class="chip${filters.hasMajor ? " on" : ""}" data-viol="hasMajor">Major</button>`;
  }

  function render() {
    const visible = filterOrders(payload.orders, filters);
    const sites = groupSites(visible);
    const payable = visible.reduce((s, o) => s + o.payable, 0);
    const counties = new Set(visible.map((o) => o.county)).size;
    document.getElementById("stats").innerHTML = `
      <div class="stat"><dt>Sites on map</dt><dd>${sites.length.toLocaleString()}</dd><p>${visible.length.toLocaleString()} orders · ${payload.meta.mapped.toLocaleString()} in file</p></div>
      <div class="stat"><dt>Payable total</dt><dd>${compact.format(payable)}</dd><p>Cash due to TCEQ</p></div>
      <div class="stat"><dt>Date span</dt><dd>${(filters.dateFrom || "").slice(0, 4)}–${(filters.dateTo || "").slice(0, 4)}</dd><p>Selected range</p></div>
      <div class="stat"><dt>Counties</dt><dd>${counties.toLocaleString()}</dd><p>${(payload.meta.siteLocated || 0).toLocaleString()} site pins</p></div>
    `;

    const ranked = topCustomers(visible, filters.topLimit);
    document.getElementById("rankTitle").textContent = `Top ${filters.topLimit} customers`;
    document.getElementById("topLimit").innerHTML = [5, 10, 25].map((n) =>
      `<button class="chip${filters.topLimit === n ? " on" : ""}" data-top="${n}">${n}</button>`
    ).join("");
    const max = ranked[0]?.total || 1;
    document.getElementById("rank").innerHTML = ranked.map((row, i) => `
      <li><button data-customer="${escapeHtml(row.customer)}">
        <div class="rank-top"><span>${i + 1} ${escapeHtml(row.customer)}</span><b>${compact.format(row.total)}</b></div>
        <div class="bar"><i style="width:${Math.max(8, (row.total / max) * 100)}%"></i></div>
        <p class="meta">${row.count} order${row.count === 1 ? "" : "s"}</p>
      </button></li>
    `).join("") || `<p class="meta">No orders match the current filters.</p>`;

    const maxPayable = sites.reduce((m, o) => Math.max(m, o.payable), 0);
    layer.clearLayers();
    const renderer = L.canvas({ padding: 0.4 });
    for (const site of sites) {
      if (site.payable < HALO_MIN) continue;
      L.circleMarker([site.lat, site.lon], {
        renderer,
        radius: bubbleRadius(site.payable, maxPayable) * 2.4,
        color: "#c96a4a",
        weight: 0,
        fillColor: "#c96a4a",
        fillOpacity: 0.12,
        opacity: 0,
        interactive: false,
      }).addTo(layer);
    }
    for (const site of sites) {
      const ring = COMPLIANCE_RING[site.reClass || "UNCLASSIFIED"] || "#c96a4a";
      const marker = L.circleMarker([site.lat, site.lon], {
        renderer,
        radius: bubbleRadius(site.payable, maxPayable),
        color: ring,
        weight: site.reClass && site.reClass !== "UNCLASSIFIED" ? 1.4 : 0.7,
        fillColor: "#c96a4a",
        fillOpacity: 0.32 + Math.min(site.payable / Math.max(maxPayable, 1), 1) * 0.28,
        opacity: 0.95,
      });
      const label = site.siteName && site.siteName !== site.customer ? site.siteName : site.customer;
      marker.bindTooltip(`<strong>${escapeHtml(label)}</strong><br/>${money.format(site.payable)} · ${site.count} order${site.count === 1 ? "" : "s"}`, {
        className: "order-tip", sticky: true, opacity: 1, direction: "top",
      });
      if (!mobile) marker.bindPopup(popupHtml(site), { maxWidth: 340, autoPanPadding: [24, 24] });
      marker.on("click", () => {
        showDetail(site);
        if (mobile) document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      marker.addTo(layer);
    }

    if (!focusedSearch && urlQuery && sites.length) {
      focusedSearch = true;
      if (sites.length === 1) map.flyTo([sites[0].lat, sites[0].lon], 10, { duration: 0.6 });
      else map.fitBounds(sites.map((site) => [site.lat, site.lon]), { padding: [40, 40], maxZoom: 10 });
    }

    drawChips();
    bindChips();
  }

  function hideEarlyAccess() {
    const overlay = document.getElementById("earlyAccess");
    if (!overlay || !overlay.classList.contains("open")) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onEarlyAccessKey);
    document.getElementById("reportCta")?.focus();
  }

  function onEarlyAccessKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      hideEarlyAccess();
    }
  }

  function showEarlyAccess() {
    let overlay = document.getElementById("earlyAccess");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "earlyAccess";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="earlyAccessTitle">
          <h2 id="earlyAccessTitle">Early access</h2>
          <p>Full site compliance reports are not open for purchase yet. We're finishing review and fulfillment. Check back soon, or email <a href="mailto:report@texmetrics.com">report@texmetrics.com</a> if you'd like to be notified.</p>
          <button type="button" class="modal-close">Close</button>
        </div>`;
      overlay.addEventListener("click", (e) => { if (e.target === overlay) hideEarlyAccess(); });
      overlay.querySelector(".modal-close").addEventListener("click", hideEarlyAccess);
      document.body.appendChild(overlay);
    }
    if (overlay.classList.contains("open")) return;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onEarlyAccessKey);
    overlay.querySelector(".modal-close").focus();
  }

  function showDetail(site) {
    const el = document.getElementById("detail");
    el.classList.remove("dash");
    const title = site.siteName && site.siteName !== site.customer ? site.siteName : site.customer;
    const orders = site.orders.slice(0, 12).map((order) =>
      `<div class="row"><dt>${escapeHtml(formatDate(order.orderDate))}</dt><dd>${escapeHtml(money.format(order.payable))} · ${escapeHtml(order.program)}</dd></div>`
    ).join("");
    el.innerHTML = `
      <p class="kicker">Selected site</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="amount">${money.format(site.payable)}</p>
      <p class="meta">Total payable · ${site.count} agreed order${site.count === 1 ? "" : "s"}</p>
      <div class="report-cta">
        <button type="button" class="report-cta-button" id="reportCta">Request compliance report for this RN</button>
        <p>PDF: ratings, peers, enforcement history, linked agreed orders — public TCEQ data.</p>
      </div>
      <dl>
        <div class="row"><dt>RN</dt><dd>${site.rn ? escapeHtml(site.rn) : "Not in source file"}</dd></div>
        <div class="row"><dt>Rating</dt><dd>${escapeHtml(CLASS_LABEL[site.reClass] || "Unclassified")}</dd></div>
        <div class="row"><dt>Business</dt><dd>${escapeHtml(site.biz || "Unknown")}</dd></div>
        <div class="row"><dt>County</dt><dd>${escapeHtml(site.county)}</dd></div>
        ${site.address || site.city ? `<div class="row"><dt>Address</dt><dd>${escapeHtml([site.address, site.city].filter(Boolean).join(", "))}</dd></div>` : ""}
        <div class="row"><dt>Location</dt><dd>${site.loc === "site" ? "Facility site" : "County center"}</dd></div>
        <div class="row"><dt>Violations</dt><dd>${escapeHtml(violLine(site))}</dd></div>
        ${orders}
      </dl>
    `;
    document.getElementById("reportCta").addEventListener("click", showEarlyAccess);
  }

  document.getElementById("detail").innerHTML = `<p class="kicker">Selected site</p><p class="meta" style="margin-top:8px">Click a pin to see every agreed order and violation count at that RN.</p>`;

  document.getElementById("query").addEventListener("input", (e) => { filters.query = e.target.value; render(); });
  document.getElementById("program").addEventListener("change", (e) => { filters.program = e.target.value; render(); });
  document.getElementById("reClass").addEventListener("change", (e) => { filters.reClass = e.target.value; render(); });
  document.getElementById("biz").addEventListener("change", (e) => { filters.biz = e.target.value; render(); });
  document.getElementById("county").addEventListener("change", (e) => {
    filters.county = e.target.value;
    if (filters.county) {
      const sample = payload.orders.find((o) => o.county === filters.county);
      if (sample) map.flyTo([sample.lat, sample.lon], 9, { duration: 0.55 });
    } else {
      map.flyTo([31.15, -99.35], 6, { duration: 0.45 });
    }
    render();
  });

  function bindChips() {
    document.querySelectorAll("[data-date]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Object.assign(filters, applyPreset(btn.dataset.date, payload.meta.dateMin, payload.meta.dateMax));
        render();
      });
    });
    document.querySelectorAll("[data-amt]").forEach((btn) => {
      btn.addEventListener("click", () => { filters.minPayable = Number(btn.dataset.amt); render(); });
    });
    document.querySelectorAll("[data-viol]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.viol;
        filters[key] = !filters[key];
        render();
      });
    });
    document.querySelectorAll("[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => { filters.customer = ""; render(); });
    });
    document.getElementById("fromYear").addEventListener("change", (e) => {
      filters.dateFrom = `${e.target.value}-01-01`; render();
    });
    document.getElementById("toYear").addEventListener("change", (e) => {
      filters.dateTo = `${e.target.value}-12-31`; render();
    });
    document.querySelectorAll("[data-top]").forEach((btn) => {
      btn.addEventListener("click", () => { filters.topLimit = Number(btn.dataset.top); render(); });
    });
    document.querySelectorAll("#rank [data-customer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filters.customer = filters.customer === btn.dataset.customer ? "" : btn.dataset.customer;
        render();
      });
    });
  }

  render();
}

main().catch((err) => {
  document.getElementById("app").innerHTML = `<h1>Texas Agreed Orders</h1><p>${escapeHtml(err.message)}</p>`;
});
