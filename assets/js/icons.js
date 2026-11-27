// Animated weather glyphs. Pure SVG + CSS (see .wx rules in styles.css).
// Each glyph is drawn on a 64×64 grid from a few shared parts.

const CLOUD = 'M17 50h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 27 11.5 11.5 0 0 0 17 50Z';
const CLOUD_SMALL = 'M22 46h24a8.5 8.5 0 0 0 1-17 12 12 0 0 0-22.8-2.4A9.7 9.7 0 0 0 22 46Z';

const sun = (cx = 32, cy = 32, r = 10) => `
  <g class="wx-sun">
    <g class="wx-rays" style="transform-origin:${cx}px ${cy}px">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
        const rad = (a * Math.PI) / 180;
        const x1 = cx + Math.cos(rad) * (r + 5), y1 = cy + Math.sin(rad) * (r + 5);
        const x2 = cx + Math.cos(rad) * (r + 10), y2 = cy + Math.sin(rad) * (r + 10);
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }).join('')}
    </g>
    <circle class="wx-sun-core" cx="${cx}" cy="${cy}" r="${r}"/>
  </g>`;

// Crescent moon (24-unit artwork scaled into place).
const moon = (cx = 32, cy = 32, r = 12) => {
  const k = (r * 2) / 17;
  return `<path class="wx-moon" transform="translate(${(cx - 12 * k).toFixed(2)} ${(cy - 12.5 * k).toFixed(2)}) scale(${k.toFixed(3)})" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>`;
};

const cloud = (cls = '', d = CLOUD) => `<path class="wx-cloud ${cls}" d="${d}"/>`;

const drops = (n = 3, cls = 'wx-drop') => {
  const xs = n === 2 ? [26, 38] : [22, 32, 42];
  return xs.map((x, i) => `<line class="${cls}" style="animation-delay:${(i * 0.28).toFixed(2)}s" x1="${x}" y1="52" x2="${x - 3}" y2="60"/>`).join('');
};

const flakes = () => [22, 32, 42].map((x, i) =>
  `<circle class="wx-flake" style="animation-delay:${(i * 0.45).toFixed(2)}s" cx="${x}" cy="55" r="2.3"/>`).join('');

const bolt = () => `<path class="wx-bolt" d="M33 44 26 55h6l-3 8 9-12h-6l3-7Z"/>`;

const fogLines = () => `
  <line class="wx-fogline" x1="14" y1="54" x2="44" y2="54"/>
  <line class="wx-fogline wx-fogline-2" x1="22" y1="60" x2="52" y2="60"/>`;

const PARTS = {
  clear: day => (day ? sun() : moon()),
  partly: day => `${day ? sun(24, 24, 8) : moon(25, 24, 10)}${cloud('wx-cloud-front', 'M22 52h26a9.5 9.5 0 0 0 1.2-18.9A13 13 0 0 0 24.4 31.6 10 10 0 0 0 22 52Z')}`,
  cloudy: () => `${cloud('wx-cloud-back', CLOUD_SMALL.replace('M22 46', 'M30 38'))}${cloud()}`,
  fog: () => `${cloud('wx-cloud-dim', 'M17 44h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 21 11.5 11.5 0 0 0 17 44Z')}${fogLines()}`,
  drizzle: () => `${cloud('', 'M17 46h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 23 11.5 11.5 0 0 0 17 46Z')}${drops(2)}`,
  rain: () => `${cloud('wx-cloud-dark', 'M17 46h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 23 11.5 11.5 0 0 0 17 46Z')}${drops(3)}`,
  freezing: () => `${cloud('wx-cloud-dark', 'M17 46h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 23 11.5 11.5 0 0 0 17 46Z')}${drops(3, 'wx-drop wx-drop-ice')}`,
  snow: () => `${cloud('', 'M17 46h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 23 11.5 11.5 0 0 0 17 46Z')}${flakes()}`,
  storm: () => `${cloud('wx-cloud-dark', 'M17 44h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19.6 21 11.5 11.5 0 0 0 17 44Z')}${bolt()}`,
};

/** Returns an inline SVG string for a weather category. */
export function weatherIcon(cat, isDay = true, { size = 48, label = '' } = {}) {
  const draw = PARTS[cat] || PARTS.cloudy;
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="wx wx-${cat}" viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}>${draw(isDay)}</svg>`;
}

/** Reference to a symbol in the inline UI sprite. */
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
