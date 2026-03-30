/** For static hosting: fetch deploy-config.json so /api/* can target a separate Express origin. */
window.krogerCartApiBase = async function () {
  try {
    var r = await fetch("/deploy-config.json", { cache: "no-store" });
    if (r.ok) {
      var j = await r.json();
      var o = j.apiOrigin && String(j.apiOrigin).trim().replace(/\/$/, "");
      if (!o) return window.location.origin;
      if (/^https?:\/\//i.test(o)) return o;
      var low = o.toLowerCase();
      var sch =
        low.indexOf("localhost") === 0 || low.indexOf("127.0.0.1") === 0 ? "http://" : "https://";
      return sch + o.replace(/^\/+/, "");
    }
  } catch (e) {}
  return window.location.origin;
};
