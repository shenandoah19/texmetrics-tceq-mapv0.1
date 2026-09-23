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
  const LIST_CAP = 25;
  const EMPTY_KICKER = "Independent map of TCEQ public records";
  const SEARCH_KICKER = "Public TCEQ records. Not a TCEQ site.";
  const EMPTY_DETAIL =
    '<p class="kicker">Selected site</p><p class="meta" style="margin-top:8px">Click a pin to see every agreed order and violation count at that RN.</p>';
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  let mode = "orders";
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

  function payableInWindow(orders, filters) {
    let sum = 0;
    const from = filters && filters.dateFrom;
    const to = filters && filters.dateTo;
    for (let i = 0; i < orders.length; i++) {
      const date = orders[i].orderDate || "";
      if (from && date < from) continue;
      if (to && date > to) continue;
      sum += Number(orders[i].payable) || 0;
    }
    return sum;
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

  function figureText(rec) {
    const payable = inWindow(rec);
    if (payable > 0) return money.format(payable);
    return rec.violActive + " active";
  }

  function violationsLine(rec) {
    const bits = [rec.violActive + " active"];
    if (rec.violRepeat) bits.push(rec.violRepeat + " repeat");
    return bits.join(" · ");
  }

  function programLine(rec) {
    const programs = Array.isArray(rec.programs) ? rec.programs.slice() : [];
    programs.sort((a, b) => (a === "PWS" ? -1 : b === "PWS" ? 1 : a.localeCompare(b)));
    const bits = programs.slice(0, 3);
    if (rec.cn) bits.push(rec.cn);
    return bits.join(" · ");
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

  function paintCard(rec) {
    const el = document.getElementById("detail");
    if (!el || !rec) return;
    const payable = inWindow(rec);
    const outside = payable <= 0 && rec.payableAll > 0;
    const open = payable <= 0;
    const county = countyLabel(rec.county);
    const rnLine = [rec.rn, county].filter(Boolean).join(" · ");
    const programs = programLine(rec);
    let hero = money.format(payable);
    let note = '<p class="meta">' + escapeHtml(violationsLine(rec)) + "</p>";
    let kicker = "Selected site";
    if (outside) {
      kicker = "Open violations";
      hero = rec.violActive + " active";
      note = '<p class="meta">' + escapeHtml(money.format(rec.payableAll) + " outside the selected years.") + "</p>";
    } else if (open) {
      kicker = "Open violations";
      hero = rec.violActive + " active";
      note = '<p class="meta">No agreed-order penalty in this extract.</p>';
    }
    const where = rec.loc === "county"
      ? '<p class="meta">Plotted at the county center. Facility coordinates were not in the extract.</p>'
      : "";
    el.classList.remove("dash");
    el.dataset.siteRn = rec.rn;
    el.dataset.texmetricsCard = "1";
    el.innerHTML =
      '<p class="kicker">' + escapeHtml(kicker) + "</p>" +
      "<h2>" + escapeHtml(rec.name) + "</h2>" +
      '<p class="amount">' + escapeHtml(hero) + "</p>" +
      note +
      '<p class="meta">' + escapeHtml(rnLine) + "</p>" +
      (programs ? '<p class="meta">' + escapeHtml(programs) + "</p>" : "") +
      where +
      '<div class="report-cta">' + reportHtml(rec.rn) + "</div>";
    const btn = document.getElementById("reportCta");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.__texmetricsOpenReport === "function") window.__texmetricsOpenReport(rec.rn);
      });
    }
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

  function activeRadius(count, maxCount) {
    const t = Math.sqrt(Math.max(count, 1) / Math.max(maxCount, 1));
    return 3.2 + t * 6.2;
  }

  function activeSites() {
    const filters = filtersNow();
    const county = filters.county ? String(filters.county).toUpperCase() : "";
    const rows = [];
    byRn.forEach((site) => {
      if (!(Number(site.violActive) > 0)) return;
      if (county && String(site.county || "").toUpperCase() !== county) return;
      const pair = finitePair(site.lat, site.lon);
      if (!pair) return;
      rows.push(site);
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
    let maxCount = 1;
    for (let i = 0; i < rows.length; i++) maxCount = Math.max(maxCount, Number(rows[i].violActive) || 0);
    activeRns = new Set();
    for (let i = 0; i < rows.length; i++) {
      const site = rows[i];
      const pair = finitePair(site.lat, site.lon);
      activeRns.add(site.rn);
      const marker = L.circleMarker([pair.lat, pair.lon], {
        radius: activeRadius(Number(site.violActive) || 0, maxCount),
        color: PIN,
        weight: 1,
        fillColor: PIN,
        fillOpacity: 0.85,
        opacity: 1,
      });
      marker.on("click", () => choose(records().get(site.rn), false));
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
    if (!rec || onLayer(rec.rn) || !Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) {
      clearSelectPin();
      return;
    }
    const layer = ensureSelectLayer();
    if (!layer) return;
    layer.clearLayers();
    const radius = mode === "active" ? activeRadius(rec.violActive || 1, rec.violActive || 1) : 7;
    L.circleMarker([rec.lat, rec.lon], {
      radius: radius,
      color: mode === "orders" && rec.payableAll > 0 ? "#c96a4a" : PIN,
      weight: 2,
      fillColor: mode === "orders" && rec.payableAll > 0 ? "#c96a4a" : PIN,
      fillOpacity: 0.9,
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
      legend.innerHTML = '<p class="kicker">One pin per RN</p><p>Size = total payable at site</p><p>Glow = $100k+ · ring = rating</p>';
    }
    const card = rankCard();
    const kicker = card && card.querySelector(".kicker");
    if (kicker) kicker.textContent = "Ranked by payable";
    const lede = document.querySelector("header .lede");
    if (lede) lede.textContent = "One pin per facility RN. Size is total payable at that site. Glow marks $100,000 or more. Ring color is compliance rating.";
  }

  function paintActiveChrome(rows) {
    const legend = legendEl();
    if (legend) {
      legend.innerHTML = '<p class="kicker">One pin per site</p><p>Size = active violations. Not a fine.</p>';
    }
    const lede = document.querySelector("header .lede");
    if (lede) lede.textContent = "One pin per site with an active violation. Size is the active count. Not a fine.";
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
        '<div class="stat"><dt>Sites with active violations</dt><dd>' + sitesN.toLocaleString() + "</dd><p>Active right now</p></div>" +
        '<div class="stat"><dt>Active violations</dt><dd>' + activeN.toLocaleString() + "</dd><p>Not a payable total</p></div>" +
        '<div class="stat"><dt>Date span</dt><dd>' + escapeHtml((filters.dateFrom || "").slice(0, 4) + "–" + (filters.dateTo || "").slice(0, 4)) + "</dd><p>Selected range</p></div>" +
        '<div class="stat"><dt>Counties</dt><dd>' + counties.size.toLocaleString() + "</dd><p>Sites on this layer</p></div>";
    }
    const card = rankCard();
    if (!card || card.hidden) return;
    const kicker = card.querySelector(".kicker");
    if (kicker) kicker.textContent = "Ranked by active violations";
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
        '<div class="rank-top"><span>' + (i + 1) + " " + escapeHtml(site.name) + "</span><b>" + count.toLocaleString() + " active</b></div>" +
        '<div class="bar"><i style="width:' + Math.max(8, (count / max) * 100) + '%"></i></div>' +
        '<p class="meta">' + escapeHtml(site.rn) + " · " + escapeHtml(countyLabel(site.county)) + "</p>" +
        "</button></li>"
      );
    }).join("") || '<p class="meta">No sites with active violations.</p>';
  }

  function paintToggle() {
    const host = document.getElementById("viols");
    if (!host) return;
    host.innerHTML =
      '<div class="mode-toggle" role="group" aria-label="Map layer">' +
      '<button type="button" data-mode="orders"' + (mode === "orders" ? ' class="on"' : "") + ">Agreed orders</button>" +
      '<button type="button" data-mode="active"' + (mode === "active" ? ' class="on"' : "") + ">Active violations</button>" +
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
    if (selectedRn) showSelectPin(records().get(selectedRn));
  }

  window.__texmetricsAfterRender = afterRender;

  function boot() {
    const started = Date.now();
    function tick() {
      queryEl = document.getElementById("query");
      const ready = state() && queryEl && document.getElementById("viols") && document.getElementById("stats");
      if (ready) {
        ensureList();
        document.getElementById("viols").addEventListener("click", (event) => {
          const btn = event.target.closest("[data-mode]");
          if (!btn || btn.getAttribute("data-mode") === mode) return;
          mode = btn.getAttribute("data-mode");
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
      const rows = Array.isArray(payload) ? payload : payload.sites || [];
      violationSites = rows.filter((site) => site && site.rn);
      byRn = new Map();
      violationSites.forEach((site) => {
        site.rn = String(site.rn).trim().toUpperCase();
        if (!Array.isArray(site.programs)) site.programs = [];
        byRn.set(site.rn, site);
      });
      if (mode === "active") afterRender();
      syncSearch();
    });
  }

  loadSites().catch(() => {});
  boot();
})();
