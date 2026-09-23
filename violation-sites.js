/* Violation-only search. Agreed-order bubbles stay on their own layer. */
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
  const PIN_RADIUS = 7;
  const LIST_CAP = 25;
  const EMPTY_DETAIL =
    '<p class="kicker">Selected site</p><p class="meta" style="margin-top:8px">Click a pin to see every agreed order and violation count at that RN.</p>';

  let sites = [];
  let byRn = new Map();
  let sitesReady = false;
  let pinLayer = null;
  let pinnedRn = "";
  let lockedRn = "";
  let lockedQuery = "";
  let queryEl = null;
  let listEl = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&#38;",
      "<": "&#60;",
      ">": "&#62;",
      '"': "&#34;",
      "'": "&#39;",
    }[ch]));
  }

  function countyLabel(county) {
    const raw = String(county || "").trim();
    if (!raw) return "";
    const label = raw
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    return /county$/i.test(label) ? label : label + " County";
  }

  function heroLine(site) {
    return site.violActive + " active · " + site.violRepeat + " repeat";
  }

  function reportHtml(rn) {
    const sample = rn === "RN100209931";
    const label = sample
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

  function agreedVisibleCount() {
    const stats = document.querySelectorAll("#stats .stat");
    for (let i = 0; i < stats.length; i++) {
      const label = stats[i].querySelector("dt");
      if (!label || label.textContent.trim() !== "Sites on map") continue;
      const raw = (stats[i].querySelector("dd")?.textContent || "").replace(/[^\d]/g, "");
      return raw ? Number(raw) : 0;
    }
    return null;
  }

  function isViolationCard() {
    const kicker = document.querySelector("#detail .kicker");
    return !!(kicker && kicker.textContent.trim() === "Open violations");
  }

  function clearViolationCard() {
    if (!isViolationCard()) return;
    const el = document.getElementById("detail");
    if (!el) return;
    el.classList.add("dash");
    el.innerHTML = EMPTY_DETAIL;
    delete el.dataset.siteRn;
  }

  function hideList() {
    if (!listEl) return;
    listEl.hidden = true;
    listEl.innerHTML = "";
  }

  function clearPin() {
    pinnedRn = "";
    if (pinLayer) pinLayer.clearLayers();
  }

  function ensureList() {
    if (listEl) return listEl;
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
      const site = byRn.get(btn.getAttribute("data-rn"));
      if (!site || !queryEl) return;
      lockedRn = site.rn;
      lockedQuery = queryEl.value.trim().toLowerCase();
      choose(site);
      paintList(lastMatches);
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
      hideList();
      return;
    }
    list.hidden = false;
    list.innerHTML = shown
      .map((site) => {
        const on = site.rn === pinnedRn ? " on" : "";
        const county = countyLabel(site.county);
        const bits = [site.rn, county, heroLine(site)].filter(Boolean);
        return (
          '<li><button type="button" class="viol-hit' +
          on +
          '" data-rn="' +
          escapeHtml(site.rn) +
          '"><div class="name">' +
          escapeHtml(site.name) +
          '</div><p class="meta">' +
          escapeHtml(bits.join(" · ")) +
          "</p></button></li>"
        );
      })
      .join("");
  }

  function showCard(site) {
    const el = document.getElementById("detail");
    if (!el) return;
    const county = countyLabel(site.county);
    const where =
      site.loc === "county"
        ? '<p class="meta">Plotted at the county center. Facility coordinates were not in the extract.</p>'
        : "";
    const subtitle = [county, site.rn].filter(Boolean).join(" · ");
    el.classList.remove("dash");
    el.dataset.siteRn = site.rn;
    el.innerHTML =
      '<p class="kicker">Open violations</p>' +
      "<h2>" +
      escapeHtml(site.name) +
      "</h2>" +
      (subtitle ? '<p class="meta">' + escapeHtml(subtitle) + "</p>" : "") +
      '<p class="amount">' +
      escapeHtml(heroLine(site)) +
      "</p>" +
      '<p class="meta">No agreed-order penalty in this extract.</p>' +
      where +
      '<div class="report-cta">' +
      reportHtml(site.rn) +
      "</div>";
    const btn = document.getElementById("reportCta");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.__texmetricsOpenReport === "function") {
          window.__texmetricsOpenReport(site.rn);
        }
      });
    }
    if (window.matchMedia("(max-width: 720px)").matches) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showPin(site) {
    const map = window.__texmetricsMap;
    if (!map || !window.L) return;
    const lat = Number(site.lat);
    const lon = Number(site.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      clearPin();
      return;
    }
    if (!pinLayer) pinLayer = L.layerGroup().addTo(map);
    pinLayer.clearLayers();
    L.circleMarker([lat, lon], {
      radius: PIN_RADIUS,
      color: PIN,
      weight: 2,
      fillColor: PIN,
      fillOpacity: 1,
      opacity: 1,
      interactive: false,
    }).addTo(pinLayer);
    if (pinnedRn === site.rn) return;
    pinnedRn = site.rn;
    const zoom = Math.max(map.getZoom(), 9);
    const nudgeIntoView = () => {
      const el = map.getContainer();
      const box = el.getBoundingClientRect();
      const visibleTop = Math.max(box.top, 0);
      const visibleBottom = Math.min(box.bottom, window.innerHeight);
      if (visibleBottom - visibleTop < 80) return;
      const desiredY = (visibleTop + visibleBottom) / 2 - box.top;
      const pt = map.latLngToContainerPoint([lat, lon]);
      const dy = pt.y - desiredY;
      if (Math.abs(dy) > 12) map.panBy([0, dy], { animate: false });
    };
    map.flyTo([lat, lon], zoom, { duration: 0.55 });
    map.once("moveend", nudgeIntoView);
  }

  function choose(site) {
    showCard(site);
    showPin(site);
  }

  function search(query) {
    const q = query.toLowerCase();
    const hits = [];
    for (let i = 0; i < sites.length; i++) {
      if (sites[i]._q.includes(q)) hits.push(sites[i]);
    }
    hits.sort((a, b) => b.violActive - a.violActive || b.violRepeat - a.violRepeat || a.name.localeCompare(b.name));
    return hits;
  }

  function sync() {
    if (!queryEl) return;
    const query = queryEl.value.trim();
    const key = query.toLowerCase();
    if (!query) {
      lockedRn = "";
      lockedQuery = "";
      lastMatches = [];
      hideList();
      clearPin();
      clearViolationCard();
      return;
    }
    const agreed = agreedVisibleCount();
    if (agreed === null) return;
    if (agreed > 0) {
      lockedRn = "";
      lockedQuery = "";
      lastMatches = [];
      hideList();
      clearPin();
      clearViolationCard();
      return;
    }
    if (!sitesReady) return;
    if (key !== lockedQuery) lockedRn = "";
    const matches = search(query);
    lastMatches = matches;
    let picked = null;
    if (matches.length === 1) picked = matches[0];
    else if (lockedRn) picked = byRn.get(lockedRn) || null;
    if (picked && !matches.some((site) => site.rn === picked.rn)) picked = null;
    if (picked) choose(picked);
    else clearPin();
    paintList(matches);
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
      sites = rows.filter((site) => site && site.rn);
      byRn = new Map();
      sites.forEach((site) => {
        site.rn = String(site.rn).trim().toUpperCase();
        site._q = [site.name, site.rn, site.county, countyLabel(site.county), site.address, site.city]
          .join("\n")
          .toLowerCase();
        byRn.set(site.rn, site);
      });
      sitesReady = true;
      sync();
    });
  }

  function boot() {
    const started = Date.now();
    function tick() {
      queryEl = document.getElementById("query");
      const map = window.__texmetricsMap;
      if (queryEl && map && document.getElementById("stats")) {
        ensureList();
        queryEl.addEventListener("input", sync);
        window.addEventListener("message", () => setTimeout(sync, 0));
        sync();
        return;
      }
      if (Date.now() - started > 30000) return;
      requestAnimationFrame(tick);
    }
    tick();
  }

  loadSites().catch(() => {});
  boot();
})();
