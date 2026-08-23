/* Forwards ?q= from the Framer page into the map iframe. */
(function () {
  function getQ() {
    try {
      return (new URLSearchParams(location.search).get("q") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function isMapFrame(src) {
    if (!src) return false;
    if (/texmetrics-tceq-map/i.test(src)) return true;
    try {
      return /embed\.html$/i.test(new URL(src, location.href).pathname);
    } catch (e) {
      return false;
    }
  }

  function withQuery(src, q) {
    try {
      var url = new URL(src, location.href);
      if (!isMapFrame(url.href)) return null;
      if ((url.searchParams.get("q") || "").trim() === q) return null;
      url.searchParams.set("q", q);
      return url.toString();
    } catch (e) {
      return null;
    }
  }

  function apply() {
    var q = getQ();
    if (!q) return;
    var frames = document.querySelectorAll("iframe");
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      var src = frame.getAttribute("src") || frame.src || "";
      if (!isMapFrame(src)) continue;
      var next = withQuery(src, q);
      if (next) {
        frame.src = next;
        frame.setAttribute("src", next);
      }
    }
  }

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "texmetrics-request-query") return;
    var q = getQ();
    if (!q || !event.source) return;
    try {
      event.source.postMessage({ type: "texmetrics-set-query", q: q }, "*");
    } catch (e) {}
  });

  apply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  }
  try {
    new MutationObserver(apply).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  } catch (e) {}
})();
