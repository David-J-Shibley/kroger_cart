/** For static hosting: fetch deploy-config.json so /api/* can target a separate Express origin. */
window.krogerCartApiBase = async function () {
  try {
    var r = await fetch("/deploy-config.json", { cache: "no-store" });
    if (r.ok) {
      var j = await r.json();
      var o = j.apiOrigin && String(j.apiOrigin).replace(/\/$/, "");
      if (o && /^https?:\/\//i.test(o)) return o;
    }
  } catch (e) {}
  return window.location.origin;
};
