// Visitor analytics — GoatCounter (https://www.goatcounter.com): no cookies, no personal data,
// no consent banner needed. Off until a site code is set in the page's
//   <meta name="wtt-goatcounter" content="your-code">
//
// Privacy: trip links carry the places people search for (?from=San+Jose~…). We only ever send
// the page path (e.g. "/weather-to-travel-claude/"), never the query string, so no trip details
// leave the browser. Product events are sent as generic names ("plan", "poster", …).

const CODE = document.querySelector('meta[name="wtt-goatcounter"]')?.content.trim();
export const enabled = !!CODE && /^[a-z0-9-]+$/i.test(CODE);

if (enabled) {
  window.goatcounter = {
    // Count the page, not the trip: drop the query string.
    path: () => location.pathname,
  };
  const sc = document.createElement('script');
  sc.async = true;
  sc.src = 'https://gc.zgo.at/count.js';
  sc.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  document.head.appendChild(sc);
}

/** Count a product event (a no-op unless analytics is configured). */
export function track(name) {
  if (!enabled) return;
  const send = () => {
    try { window.goatcounter.count({ path: `event/${name}`, title: name, event: true }); } catch { /* ignore */ }
  };
  // The counter script loads asynchronously; queue early events until it's ready.
  if (typeof window.goatcounter?.count === 'function') send();
  else {
    let tries = 0;
    const t = setInterval(() => {
      if (typeof window.goatcounter?.count === 'function' || ++tries > 20) { clearInterval(t); if (tries <= 20) send(); }
    }, 500);
  }
}

// A visit that arrived through a shared trip link (counted without the trip itself).
if (enabled && new URLSearchParams(location.search).has('from')) track('opened-shared-link');
