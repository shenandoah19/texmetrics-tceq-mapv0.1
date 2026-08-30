/* Load last-good map, swap Esri tiles, rank sites (not customers), RN CTA. */
(async function () {
  const srcUrl =
    "https://raw.githubusercontent.com/shenandoah19/texmetrics-tceq-mapv0.1/35b444aef39feafca4c7047530965d3598cc9cca/app.js";
  const res = await fetch(srcUrl, { cache: "no-store" });
  if (!res.ok) {
    document.getElementById("app").innerHTML =
      "<h1>Texas Agreed Orders</h1><p>Could not load map script.</p>";
    return;
  }
  let src = await res.text();

  src = src.replaceAll(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  );
  src = src.replace(
    'attribution: "&copy; OpenStreetMap &copy; CARTO"',
    'attribution: "Tiles &copy; Esri"'
  );
  src = src.replace(/\n\s*subdomains:\s*"abcd",/, "");
  src = src.replace(/maxZoom:\s*18/, "maxZoom: 16");

  const helpers = [
    "function siteLabel(site) {",
    "  return site.siteName && site.siteName !== site.customer ? site.siteName : (site.siteName || site.customer || site.rn || \"Unnamed site\");",
    "}",
    "function siteKey(site) {",
    "  return (site.rn || \"\").trim().toUpperCase() || (\"GEO:\" + Number(site.lat).toFixed(5) + \",\" + Number(site.lon).toFixed(5));",
    "}",
    "function topSites(sites, limit) {",
    "  return sites.slice().sort(function (a, b) { return b.payable - a.payable || b.count - a.count; }).slice(0, limit || 10);",
    "}",
    "function reportCtaHtml(site, extraClass) {",
    "  const rn = (site.rn || \"\").trim().toUpperCase();",
    "  if (!rn) return '<p class=\"meta\">No RN in the source file \u2014 report not available.</p>';",
    "  return '<button type=\"button\" class=\"report-cta-button ' + (extraClass || \"\") + '\" data-rn=\"' + escapeHtml(rn) + '\">Get the TexMetrics report for this site</button>';",
    "}",
  ].join("\n");

  src = src.replace(
    /function topCustomers\(orders, limit = 5\) \{[\s\S]*?return \[\.\.\.map\.values\(\)\]\.sort\(\(a, b\) => b\.total - a\.total\)\.slice\(0, limit\);\n\}/,
    helpers
  );

  src = src.replace(
    '<ol class="order-list">${items}${more}</ol>\n  </div>`;',
    '<ol class="order-list">${items}${more}</ol>\n    ${reportCtaHtml(site, "popup-cta")}\n  </div>`;'
  );

  src = src.replace("Top 10 customers", "Top 10 sites");

  src = src.replace(
    "  const layer = L.layerGroup().addTo(map);",
    "  const layer = L.layerGroup().addTo(map);\n  const markersByKey = new Map();"
  );

  if (!src.includes("const ranked = topCustomers")) {
    throw new Error("rank block not found in source");
  }

  src = src.replace(
    /const ranked = topCustomers\(visible, filters\.topLimit\);[\s\S]*?No orders match the current filters\.<\/p>`;/,
    [
      "const ranked = topSites(sites, filters.topLimit);",
      "    document.getElementById(\"rankTitle\").textContent = `Top ${filters.topLimit} sites`;",
      "    document.getElementById(\"topLimit\").innerHTML = [5, 10, 25].map((n) =>",
      "      `<button class=\"chip${filters.topLimit === n ? \" on\" : \"\"}\" data-top=\"${n}\">${n}</button>`",
      "    ).join(\"\");",
      "    const max = ranked[0]?.payable || 1;",
      "    const selectedKey = selectedSite ? siteKey(selectedSite) : \"\";",
      "    document.getElementById(\"rank\").innerHTML = ranked.map((row, i) => {",
      "      const label = siteLabel(row);",
      "      const key = siteKey(row);",
      "      const on = selectedKey && key === selectedKey ? \" on\" : \"\";",
      "      const rnBit = row.rn ? escapeHtml(row.rn) : \"No RN\";",
      "      return `<li><button class=\"rank-row${on}\" data-site-key=\"${escapeHtml(key)}\">",
      "        <div class=\"rank-top\"><span>${i + 1} ${escapeHtml(label)}</span><b>${compact.format(row.payable)}</b></div>",
      "        <div class=\"bar\"><i style=\"width:${Math.max(8, (row.payable / max) * 100)}%\"></i></div>",
      "        <p class=\"meta\">${rnBit} \u00b7 ${row.count} order${row.count === 1 ? \"\" : \"s\"}</p>",
      "      </button></li>`;",
      "    }).join(\"\") || `<p class=\"meta\">No sites match the current filters.</p>`;",
    ].join("\n")
  );

  src = src.replace(
    "    layer.clearLayers();",
    "    layer.clearLayers();\n    markersByKey.clear();"
  );

  src = src.replace(
    "      const label = site.siteName && site.siteName !== site.customer ? site.siteName : site.customer;",
    "      const label = siteLabel(site);"
  );

  src = src.replace(
    "      if (!mobile) marker.bindPopup(popupHtml(site), { maxWidth: 340, autoPanPadding: [24, 24] });",
    "      if (!mobile) marker.bindPopup(popupHtml(site), { maxWidth: 360, autoPanPadding: [24, 24] });"
  );

  src = src.replace(
    "      marker.on(\"click\", () => {\n        showDetail(site);\n        if (mobile) document.getElementById(\"detail\").scrollIntoView({ behavior: \"smooth\", block: \"start\" });\n      });\n      marker.addTo(layer);",
    "      marker.on(\"click\", () => selectSite(site, { openPopup: !mobile, fly: false }));\n      markersByKey.set(siteKey(site), { site, marker });\n      marker.addTo(layer);"
  );

  src = src.replace(
    "Request compliance report for this RN",
    "Get the TexMetrics report for this site"
  );

  src = src.replace(
    "    const title = site.siteName && site.siteName !== site.customer ? site.siteName : site.customer;",
    "    const title = siteLabel(site);"
  );

  const selectFns = [
    "  function highlightRank(site) {",
    "    const key = site ? siteKey(site) : \"\";",
    "    document.querySelectorAll(\"#rank .rank-row\").forEach((btn) => {",
    "      btn.classList.toggle(\"on\", btn.dataset.siteKey === key);",
    "    });",
    "  }",
    "  function selectSite(site, opts) {",
    "    opts = opts || {};",
    "    const openPopup = opts.openPopup !== undefined ? opts.openPopup : !mobile;",
    "    const fly = opts.fly !== undefined ? opts.fly : true;",
    "    showDetail(site);",
    "    highlightRank(site);",
    "    const rec = markersByKey.get(siteKey(site));",
    "    if (fly && Number.isFinite(site.lat) && Number.isFinite(site.lon)) {",
    "      map.flyTo([site.lat, site.lon], Math.max(map.getZoom(), 9), { duration: 0.55 });",
    "    }",
    "    if (openPopup && rec && rec.marker && rec.marker.getPopup()) rec.marker.openPopup();",
    "    if (mobile) document.getElementById(\"detail\").scrollIntoView({ behavior: \"smooth\", block: \"start\" });",
    "  }",
    "",
  ].join("\n");

  src = src.replace("  function showDetail(site) {", selectFns + "  function showDetail(site) {");

  src = src.replace(
    "    document.getElementById(\"reportCta\").addEventListener(\"click\", showEarlyAccess);\n  }",
    "    document.getElementById(\"reportCta\") && document.getElementById(\"reportCta\").addEventListener(\"click\", showEarlyAccess);\n    highlightRank(site);\n  }"
  );

  src = src.replace(
    "    document.querySelectorAll(\"#rank [data-customer]\").forEach((btn) => {\n      btn.addEventListener(\"click\", () => {\n        filters.customer = filters.customer === btn.dataset.customer ? \"\" : btn.dataset.customer;\n        render();\n      });\n    });\n  }",
    [
      "    document.querySelectorAll(\"#rank [data-site-key]\").forEach((btn) => {",
      "      btn.addEventListener(\"click\", () => {",
      "        const rec = markersByKey.get(btn.dataset.siteKey);",
      "        if (rec && rec.site) selectSite(rec.site, { openPopup: !mobile, fly: true });",
      "      });",
      "    });",
      "  }",
      "  map.on(\"popupopen\", (e) => {",
      "    const root = e.popup.getElement();",
      "    const btn = root && root.querySelector(\".popup-cta\");",
      "    if (!btn) return;",
      "    btn.addEventListener(\"click\", (ev) => {",
      "      ev.preventDefault();",
      "      ev.stopPropagation();",
      "      const rn = (btn.dataset.rn || \"\").trim().toUpperCase();",
      "      if (rn && selectedSite && (selectedSite.rn || \"\").toUpperCase() !== rn) {",
      "        const rec = markersByKey.get(rn);",
      "        if (rec && rec.site) showDetail(rec.site);",
      "      }",
      "      if (rn) showEarlyAccess();",
      "    });",
      "  });",
    ].join("\n")
  );

  const script = document.createElement("script");
  script.textContent = src;
  document.body.appendChild(script);
})().catch((err) => {
  const el = document.getElementById("app");
  if (el) el.innerHTML = "<h1>Texas Agreed Orders</h1><p>" + String(err.message || err) + "</p>";
});
