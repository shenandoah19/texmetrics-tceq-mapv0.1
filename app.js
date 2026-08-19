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
  return 5 + t * 21;
}

function filterOrders(orders, filters) {
  const q = filters.query.trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.program && order.program !== filters.program) return false;
    if (filters.county && order.county !== filters.county) return false;
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

function popupHtml(order) {
  const rn = order.rn ? escapeHtml(order.rn) : "Not in source file";
  return `<div class="order-popup"><h3>${escapeHtml(order.customer)}</h3><dl>
    <div><dt>Payable</dt><dd class="amount">${escapeHtml(money.format(order.payable))}</dd></div>
    <div><dt>Order date</dt><dd>${escapeHtml(formatDate(order.orderDate))}</dd></div>
    <div><dt>Program</dt><dd>${escapeHtml(order.program)}</dd></div>
    <div><dt>Case No.</dt><dd>${escapeHtml(order.caseNo)}</dd></div>
    <div><dt>County</dt><dd>${escapeHtml(order.county)}</dd></div>
    <div><dt>RN</dt><dd>${rn}</dd></div>
  </dl></div>`;
}

async function main() {
  const embed = document.documentElement.dataset.embed === "true";
  const res = await fetch("./data/tceq-orders.json");
  if (!res.ok) throw new Error("Could not load TCEQ orders data.");
  const payload = await res.json();

  const filters = {
    query: "",
    program: "",
    county: "",
    minPayable: 0,
    customer: "",
    ...applyPreset("5y", payload.meta.dateMin, payload.meta.dateMax),
  };

  const startYear = Number((payload.meta.dateMin || "2015").slice(0, 4));
  const endYear = Number((payload.meta.dateMax || "2026").slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);

  const root = document.getElementById("app");
  root.innerHTML = `
    <header>
      <p class="kicker">Texas Commission on Environmental Quality</p>
      <h1>Agreed Orders</h1>
      ${embed ? "" : `<p class="lede">Administrative penalties mapped across Texas. Bubble size is payable amount. Use the year chips to include historic fines.</p>`}
      <dl class="stats" id="stats"></dl>
      <div class="filters">
        <div class="search-row">
          <label class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
            <input id="query" placeholder="Search customer, case, county, or docket" />
          </label>
          <div class="selects">
            <select id="program"><option value="">All programs</option>${payload.programs.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}</select>
            <select id="county"><option value="">All counties</option>${payload.counties.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="chips" id="dates"></div>
        <div class="chips" id="amounts"></div>
      </div>
    </header>
    <div class="layout">
      <section class="map-wrap"><div id="map"></div>
        <div class="legend"><p class="kicker">Bubble size</p><p>Larger circle = larger payable fine</p></div>
      </section>
      <aside>
        <section class="card"><p class="kicker">Ranked by payable</p><h2>Top 5 customers</h2><ol class="rank" id="rank"></ol></section>
        <section class="card detail dash" id="detail"></section>
        <p class="note">Source: ${escapeHtml(payload.meta.source)}. ${payload.meta.skippedCoords} records had missing coordinates and were not mapped. <a href="${payload.meta.sourceUrl}" target="_blank" rel="noreferrer">Open source dataset</a></p>
      </aside>
    </div>
  `;

  const map = L.map("map", {
    center: [31.15, -99.35],
    zoom: 6,
    minZoom: 5,
    maxZoom: 11,
    maxBounds: [[25.7, -106.7], [36.6, -93.4]],
    maxBoundsViscosity: 0.7,
    preferCanvas: true,
  });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 18,
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  requestAnimationFrame(() => map.invalidateSize());

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
  }

  function render() {
    const visible = filterOrders(payload.orders, filters);
    const payable = visible.reduce((s, o) => s + o.payable, 0);
    const counties = new Set(visible.map((o) => o.county)).size;
    document.getElementById("stats").innerHTML = `
      <div class="stat"><dt>Orders on map</dt><dd>${visible.length.toLocaleString()}</dd><p>${payload.meta.mapped.toLocaleString()} in file</p></div>
      <div class="stat"><dt>Payable total</dt><dd>${compact.format(payable)}</dd><p>Filtered set</p></div>
      <div class="stat"><dt>Date span</dt><dd>${(filters.dateFrom || "").slice(0, 4)}–${(filters.dateTo || "").slice(0, 4)}</dd><p>Selected range</p></div>
      <div class="stat"><dt>Counties</dt><dd>${counties.toLocaleString()}</dd><p>${payload.meta.skippedCoords} unmapped</p></div>
    `;

    const ranked = topCustomers(visible);
    const max = ranked[0]?.total || 1;
    document.getElementById("rank").innerHTML = ranked.map((row, i) => `
      <li><button data-customer="${escapeHtml(row.customer)}">
        <div class="rank-top"><span>${i + 1} ${escapeHtml(row.customer)}</span><b>${compact.format(row.total)}</b></div>
        <div class="bar"><i style="width:${Math.max(8, (row.total / max) * 100)}%"></i></div>
        <p class="meta">${row.count} order${row.count === 1 ? "" : "s"}</p>
      </button></li>
    `).join("") || `<p class="meta">No orders match the current filters.</p>`;

    const maxPayable = visible.reduce((m, o) => Math.max(m, o.payable), 0);
    layer.clearLayers();
    for (const order of visible) {
      const marker = L.circleMarker([order.lat, order.lon], {
        renderer: L.canvas({ padding: 0.4 }),
        radius: bubbleRadius(order.payable, maxPayable),
        color: "#c96a4a",
        weight: 1,
        fillColor: "#c96a4a",
        fillOpacity: 0.38 + Math.min(order.payable / Math.max(maxPayable, 1), 1) * 0.28,
        opacity: 0.95,
      });
      marker.bindTooltip(`<strong>${escapeHtml(order.customer)}</strong><br/>${money.format(order.payable)}`, {
        className: "order-tip", sticky: true, opacity: 1, direction: "top",
      });
      marker.bindPopup(popupHtml(order), { maxWidth: 300 });
      marker.on("click", () => showDetail(order));
      marker.addTo(layer);
    }

    drawChips();
    bindChips();
  }

  function showDetail(order) {
    const el = document.getElementById("detail");
    el.classList.remove("dash");
    el.innerHTML = `
      <p class="kicker">Selected order</p>
      <h2>${escapeHtml(order.customer)}</h2>
      <p class="amount">${money.format(order.payable)}</p>
      <dl>
        <div class="row"><dt>Order date</dt><dd>${escapeHtml(formatDate(order.orderDate))}</dd></div>
        <div class="row"><dt>Program</dt><dd>${escapeHtml(order.program)}</dd></div>
        <div class="row"><dt>Case No.</dt><dd>${escapeHtml(order.caseNo)}</dd></div>
        <div class="row"><dt>County</dt><dd>${escapeHtml(order.county)}</dd></div>
        <div class="row"><dt>RN</dt><dd>${order.rn ? escapeHtml(order.rn) : "Not in source file"}</dd></div>
        <div class="row"><dt>Docket</dt><dd>${escapeHtml(order.docket)}</dd></div>
      </dl>
    `;
  }

  document.getElementById("detail").innerHTML = `<p class="kicker">Selected order</p><p class="meta" style="margin-top:8px">Click a bubble on the map to inspect a fine.</p>`;

  document.getElementById("query").addEventListener("input", (e) => { filters.query = e.target.value; render(); });
  document.getElementById("program").addEventListener("change", (e) => { filters.program = e.target.value; render(); });
  document.getElementById("county").addEventListener("change", (e) => {
    filters.county = e.target.value;
    if (filters.county) {
      const sample = payload.orders.find((o) => o.county === filters.county);
      if (sample) map.flyTo([sample.clat, sample.clon], 9, { duration: 0.55 });
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
    document.querySelectorAll("[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => { filters.customer = ""; render(); });
    });
    document.getElementById("fromYear").addEventListener("change", (e) => {
      filters.dateFrom = `${e.target.value}-01-01`; render();
    });
    document.getElementById("toYear").addEventListener("change", (e) => {
      filters.dateTo = `${e.target.value}-12-31`; render();
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
