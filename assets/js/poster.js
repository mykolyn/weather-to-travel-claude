// "Trip poster": a shareable 1080×1350 image of a planned drive, drawn on a canvas
// in the same isometric pen-and-ink style as the site's illustrations.

const W = 1080, H = 1350;
const C30 = Math.cos(Math.PI / 6);
const P = {
  paper: '#F3EFE6', surface: '#FFFDF8', ink: '#12161F', ink2: '#474D5B', ink3: '#8B8F98',
  line: 'rgba(18,22,31,.14)', accent: '#FF5A1F',
  band: { good: '#138F60', fair: '#7FA42A', mixed: '#E9840F', rough: '#D63A3A', none: '#8B8F98' },
};
const F = {
  display: '"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif',
  ui: '"Instrument Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function hatch(ctx, poly, gap, angle = Math.PI / 4, width = 1.1) {
  ctx.save();
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = (x1 - x0) + (y1 - y0);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let d = -span; d < span; d += gap) {
    const cx = (x0 + x1) / 2 + d, cy = (y0 + y1) / 2;
    ctx.moveTo(cx - Math.cos(angle) * span, cy - Math.sin(angle) * span);
    ctx.lineTo(cx + Math.cos(angle) * span, cy + Math.sin(angle) * span);
  }
  ctx.stroke();
  ctx.restore();
}

function polygon(ctx, poly, fill, stroke = P.ink, lw = 2) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function fitFont(ctx, text, weight, family, maxSize, maxW) {
  let size = maxSize;
  do { ctx.font = `${weight} ${size}px ${family}`; size -= 2; } while (ctx.measureText(text).width > maxW && size > 30);
  return size + 2;
}

/**
 * data: { from, to, leaveText, arriveText, distanceText, durationText, score, band, title, text,
 *         coords: [[lat, lon]], colorStops: [{ at, color }], stops: [{ lat, lon, label, temp, color }], url }
 */
export async function drawPoster(data) {
  if (document.fonts?.ready) await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Paper + dot grid
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(18,22,31,.13)';
  for (let y = 18; y < H; y += 30) for (let x = 18; x < W; x += 30) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill(); }

  const M = 72;
  // Header
  ctx.fillStyle = P.accent;
  ctx.beginPath(); ctx.arc(M + 8, M + 4, 8, 0, 7); ctx.fill();
  ctx.fillStyle = P.ink2;
  ctx.font = `600 22px ${F.mono}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('WEATHER TO TRAVEL', M + 28, M + 5);
  ctx.textAlign = 'right';
  ctx.fillText(data.leaveText.toUpperCase(), W - M, M + 5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Title
  const title = `${data.from} → ${data.to}`;
  const size = fitFont(ctx, title, 750, F.display, 96, W - 2 * M);
  ctx.fillStyle = P.ink;
  ctx.font = `750 ${size}px ${F.display}`;
  ctx.fillText(title, M, M + 70 + size * 0.75);
  const yTitle = M + 70 + size * 0.75;
  ctx.font = `500 26px ${F.ui}`;
  ctx.fillStyle = P.ink2;
  ctx.fillText(`${data.distanceText} · ${data.durationText} · arrive ${data.arriveText}`, M, yTitle + 52);

  // ---------- Isometric slab with the route ----------
  const lats = data.coords.map(c => c[0]), lons = data.coords.map(c => c[1]);
  const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const spanX = Math.max((lo1 - lo0) * k, 1e-6), spanY = Math.max(la1 - la0, 1e-6);
  // world plane u (east) / v (south), padded square-ish slab
  const S = 10, pad = 1.1;
  const scale = (S - 2 * pad) / Math.max(spanX, spanY);
  const uv = (lat, lon) => [pad + ((lon - lo0) * k) * scale + ((S - 2 * pad) - spanX * scale) / 2,
    pad + (la1 - lat) * scale + ((S - 2 * pad) - spanY * scale) / 2];
  const unit = 52, ox = W / 2 - S * C30 * unit * 0, oy = yTitle + 160;
  // map u → iso x axis (up-right), v → iso y axis (down-right)
  const iso = (u, v, z = 0) => [W / 2 + (u - v) * C30 * unit * 0.98 - 0, oy + (u + v) * 0.5 * unit - z * unit];
  void ox;
  const T = 0.8;
  const top = [iso(0, 0), iso(S, 0), iso(S, S), iso(0, S)];
  const left = [iso(0, S), iso(S, S), iso(S, S, -T), iso(0, S, -T)];
  const right = [iso(S, 0), iso(S, S), iso(S, S, -T), iso(S, 0, -T)];
  polygon(ctx, left, P.surface);
  hatch(ctx, left, 9);
  polygon(ctx, left, null);
  polygon(ctx, right, P.surface);
  hatch(ctx, right, 5);
  polygon(ctx, right, null);
  polygon(ctx, top, P.surface);
  // contour-ish ground ticks
  ctx.strokeStyle = 'rgba(18,22,31,.35)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 46; i++) {
    const u = (i * 7.31) % S, v = (i * 3.77 + (i % 5)) % S;
    const [x, y] = iso(u, v);
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 1.5, y - 4); ctx.moveTo(x + 1.5, y - 4); ctx.lineTo(x + 4, y); ctx.stroke();
  }

  // route (simplified) with weather colours
  const step = Math.max(1, Math.floor(data.coords.length / 400));
  const pts = data.coords.filter((_, i) => i % step === 0 || i === data.coords.length - 1).map(([la, lo]) => iso(...uv(la, lo)));
  const n = pts.length;
  const draw = (from, to, color, w) => {
    ctx.beginPath();
    for (let i = from; i <= to; i++) (i === from ? ctx.moveTo(...pts[i]) : ctx.lineTo(...pts[i]));
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  };
  draw(0, n - 1, P.ink, 15);
  draw(0, n - 1, P.surface, 10);
  data.colorStops.forEach((c, i) => {
    const a = Math.floor(c.at * (n - 1)), b = Math.ceil((data.colorStops[i + 1]?.at ?? 1) * (n - 1));
    if (b > a) draw(a, b, c.color, 6);
  });

  // stop pins with leader lines + labels (a few, so it stays legible)
  const last = data.stops.length - 1;
  const rough = data.stops.reduce((a, s, i) => (i > 0 && i < last && (s.h ?? 0) > (data.stops[a].h ?? -1) ? i : a), Math.round(last / 2));
  const pick = [...new Set([0, rough, last])];
  const boxes = [];
  data.stops.forEach((s, i) => {
    const [x, y] = iso(...uv(s.lat, s.lon));
    ctx.beginPath(); ctx.arc(x, y, i === 0 || i === data.stops.length - 1 ? 9 : 5.5, 0, 7);
    ctx.fillStyle = i === data.stops.length - 1 ? P.accent : i === 0 ? P.ink : P.surface;
    ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = P.ink; ctx.stroke();
  });
  pick.forEach(i => {
    const s = data.stops[i];
    const [x, y] = iso(...uv(s.lat, s.lon));
    ctx.font = `600 21px ${F.mono}`;
    const label = `${s.label} · ${s.temp}`;
    const w = ctx.measureText(label).width + 30;
    const bx = Math.min(Math.max(x - w / 2, 24), W - 24 - w);
    let lift = 70, by = y - lift - 38;
    const hits = () => boxes.some(b => bx < b.x + b.w + 10 && bx + w + 10 > b.x && by < b.y + 48 && by + 48 > b.y);
    while (hits() && lift < 400) { lift += 26; by = y - lift - 38; }
    boxes.push({ x: bx, y: by, w });
    ctx.setLineDash([4, 5]); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y - lift); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.roundRect(bx, by, w, 38, 19);
    ctx.fillStyle = s.warn ? s.color : P.surface; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = P.ink; ctx.stroke();
    ctx.fillStyle = s.warn ? '#fff' : P.ink; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 15, by + 20); ctx.textBaseline = 'alphabetic';
  });

  // ---------- Score card ----------
  const cy = H - 300;
  ctx.beginPath(); ctx.roundRect(M, cy, W - 2 * M, 200, 28);
  ctx.fillStyle = P.surface; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = P.ink; ctx.stroke();
  ctx.beginPath(); ctx.roundRect(M + 8, cy + 8, W - 2 * M, 200, 28); // offset shadow edge
  ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = P.ink; ctx.fill(); ctx.restore();
  const col = P.band[data.band] || P.band.none;
  const rx = M + 110, ry = cy + 100;
  ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(18,22,31,.08)'; ctx.beginPath(); ctx.arc(rx, ry, 66, 0, 7); ctx.stroke();
  ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(rx, ry, 66, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * ((data.score ?? 0) / 100)); ctx.stroke();
  ctx.fillStyle = P.ink; ctx.textAlign = 'center';
  ctx.font = `750 56px ${F.display}`; ctx.fillText(data.score ?? '—', rx, ry + 12);
  ctx.font = `500 16px ${F.mono}`; ctx.fillStyle = P.ink3; ctx.fillText('/100', rx, ry + 38);
  ctx.textAlign = 'left';
  const tx = M + 220, tw = W - M - 40 - tx;
  ctx.fillStyle = P.ink3; ctx.font = `600 16px ${F.mono}`; ctx.fillText('ROAD SCORE', tx, cy + 44);
  ctx.fillStyle = col; ctx.font = `700 46px ${F.display}`; ctx.fillText(data.title, tx, cy + 88);
  ctx.fillStyle = P.ink2; ctx.font = `400 24px ${F.ui}`;
  wrap(ctx, data.text, tw).slice(0, 3).forEach((l, i) => ctx.fillText(l, tx, cy + 128 + i * 30));

  // Footer
  ctx.fillStyle = P.ink3; ctx.font = `500 20px ${F.mono}`;
  ctx.fillText(data.url, M, H - 50);
  ctx.textAlign = 'right';
  ctx.fillText('FORECAST FOR THE WHOLE DRIVE', W - M, H - 50);
  ctx.textAlign = 'left';
  return cv;
}
