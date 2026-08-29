/* Restore last-good map code and replace Carto dark tiles (API key required) with Esri World Dark Gray. */
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
  const script = document.createElement("script");
  script.textContent = src;
  document.body.appendChild(script);
})().catch((err) => {
  const el = document.getElementById("app");
  if (el) el.innerHTML = "<h1>Texas Agreed Orders</h1><p>" + String(err.message || err) + "</p>";
});
