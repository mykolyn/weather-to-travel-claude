#!/usr/bin/env python3
"""Generates the isometric pen-and-ink illustrations and injects them into index.html.

Everything is drawn in world units (x, y, z) and projected isometrically:
    x runs up-right, y runs down-right, z is up.
Faces get a pen outline; shading is hatching (patterns defined in index.html):
    left faces  -> url(#h-light)    right faces -> url(#h-dense)
Colour is used only as a spot accent (car, sun, flag, rain).

Run:  python3 tools/build_art.py
"""
import math
import random
import re
from pathlib import Path

C = math.cos(math.radians(30))
ROOT = Path(__file__).resolve().parent.parent


class Iso:
    def __init__(self, s, ox=0.0, oy=0.0):
        self.s, self.ox, self.oy = s, ox, oy
        self.xs, self.ys = [], []

    def p(self, x, y, z=0.0):
        X = self.ox + (x + y) * C * self.s
        Y = self.oy + (y - x) * 0.5 * self.s - z * self.s
        self.xs.append(X)
        self.ys.append(Y)
        return X, Y

    def pts(self, *coords):
        return " ".join(f"{X:.1f},{Y:.1f}" for X, Y in (self.p(*c) for c in coords))

    def poly(self, coords, cls="", extra=""):
        return f'<polygon class="{cls}" points="{self.pts(*coords)}"{extra}/>'

    def line(self, a, b, cls="pen"):
        (x1, y1), (x2, y2) = self.p(*a), self.p(*b)
        return f'<line class="{cls}" x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"/>'

    def bbox(self, pad=10):
        return (min(self.xs) - pad, min(self.ys) - pad, max(self.xs) - min(self.xs) + 2 * pad,
                max(self.ys) - min(self.ys) + 2 * pad)

    # ---------- primitives ----------
    def box(self, x0, y0, z0, x1, y1, z1, top="f-top", left="f-left", right="f-right"):
        """Axis-aligned box: top, left (-x) and right (+y) faces."""
        return "".join([
            self.poly([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], left),
            self.poly([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], right),
            self.poly([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top),
        ])

    def pyramid(self, x0, y0, x1, y1, h, z0=0, left="f-left", right="f-right", cap=None):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        a = (cx, cy, z0 + h)
        out = [
            self.poly([(x0, y0, z0), (x0, y1, z0), a], left),
            self.poly([(x0, y1, z0), (x1, y1, z0), a], right),
        ]
        if cap:  # jagged snow cap
            def at(c, f):
                return tuple(a[i] + (c[i] - a[i]) * f for i in range(3))
            l, m, r = (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)
            f, g = cap, cap * 0.62
            cap_pts = [a, at(l, f), at(((l[0] + m[0]) / 2, (l[1] + m[1]) / 2, z0), g), at(m, f * 1.08),
                       at(((m[0] + r[0]) / 2, (m[1] + r[1]) / 2, z0), g), at(r, f)]
            out.append(self.poly(cap_pts, "f-snow"))
            out.append(self.line(a, at(m, f * 1.08), "pen thin"))
        out.append(self.line(a, (x0, y1, z0), "pen"))
        return "".join(out)

    def hip_house(self, x0, y0, x1, y1, h, roof, windows=True):
        out = [self.box(x0, y0, 0, x1, y1, h, top="f-top")]
        if windows:
            # windows on the right (+y) face, a door too
            w = (x1 - x0)
            for i, fx in enumerate((0.18, 0.62)):
                a, b = x0 + w * fx, x0 + w * (fx + 0.2)
                out.append(self.poly([(a, y1, h * .5), (b, y1, h * .5), (b, y1, h * .78), (a, y1, h * .78)], "f-win"))
            d = y1 - y0
            a, b = y0 + d * 0.35, y0 + d * 0.6
            out.append(self.poly([(x0, a, 0), (x0, b, 0), (x0, b, h * .55), (x0, a, h * .55)], "f-win"))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        e = 0.08
        out.append(self.pyramid(x0 - e, y0 - e, x1 + e, y1 + e, roof, z0=h, left="f-roof-l", right="f-roof-r"))
        return "".join(out)

    def tower(self, x0, y0, x1, y1, h):
        out = [self.box(x0, y0, 0, x1, y1, h)]
        for k in range(3):
            z = h * (0.25 + k * 0.25)
            for fx in (0.2, 0.6):
                a, b = x0 + (x1 - x0) * fx, x0 + (x1 - x0) * (fx + 0.22)
                out.append(self.poly([(a, y1, z), (b, y1, z), (b, y1, z + h * .12), (a, y1, z + h * .12)], "f-win"))
        return "".join(out)

    def pine(self, x, y, size=1.0):
        X, Y = self.p(x, y, 0)
        s = self.s * 0.55 * size
        out = [f'<ellipse class="f-shadow" cx="{X + s*.25:.1f}" cy="{Y:.1f}" rx="{s*.55:.1f}" ry="{s*.2:.1f}"/>',
               f'<line class="pen" x1="{X:.1f}" y1="{Y:.1f}" x2="{X:.1f}" y2="{Y - s*.35:.1f}"/>']
        for k, (w, base, top) in enumerate(((0.5, 0.3, 1.35), (0.4, 0.75, 1.75))):
            bx, by, ty = w * s, Y - base * s, Y - top * s
            self.xs += [X - bx, X + bx]
            self.ys += [ty]
            out.append(f'<polygon class="f-top" points="{X - bx:.1f},{by:.1f} {X:.1f},{ty:.1f} {X + bx:.1f},{by:.1f}"/>')
            out.append(f'<polygon class="f-right" points="{X:.1f},{by + 1:.1f} {X:.1f},{ty:.1f} {X + bx:.1f},{by:.1f}"/>')
        return "".join(out)

    def round_tree(self, x, y, size=1.0):
        X, Y = self.p(x, y, 0)
        s = self.s * 0.5 * size
        r = s * 0.62
        cy = Y - s * 1.05
        self.ys.append(cy - r)
        return (f'<ellipse class="f-shadow" cx="{X + s*.3:.1f}" cy="{Y:.1f}" rx="{s*.6:.1f}" ry="{s*.22:.1f}"/>'
                f'<line class="pen" x1="{X:.1f}" y1="{Y:.1f}" x2="{X:.1f}" y2="{cy:.1f}"/>'
                f'<circle class="f-top" cx="{X:.1f}" cy="{cy:.1f}" r="{r:.1f}"/>'
                f'<path class="f-right" d="M{X:.1f} {cy - r:.1f}A{r:.1f} {r:.1f} 0 0 1 {X:.1f} {cy + r:.1f}A{r*.45:.1f} {r:.1f} 0 0 0 {X:.1f} {cy - r:.1f}Z"/>')

    def flag(self, x, y, cls="flag-b", h=1.3):
        (X, Y) = self.p(x, y, 0)
        top = Y - h * self.s
        self.ys.append(top)
        return (f'<ellipse class="f-shadow" cx="{X:.1f}" cy="{Y:.1f}" rx="6" ry="2.5"/>'
                f'<line class="pen" x1="{X:.1f}" y1="{Y:.1f}" x2="{X:.1f}" y2="{top:.1f}"/>'
                f'<path class="{cls}" d="M{X:.1f} {top:.1f}l{self.s*.62:.1f} {self.s*.12:.1f}-{self.s*.12:.1f} {self.s*.16:.1f} {self.s*.12:.1f} {self.s*.16:.1f}L{X:.1f} {top + self.s*.4:.1f}Z"/>')

    def grass(self, x, y):
        X, Y = self.p(x, y, 0)
        return f'<path class="pen thin" d="M{X - 3:.1f} {Y:.1f}l1.5-3.5M{X:.1f} {Y:.1f}v-4.5M{X + 3:.1f} {Y:.1f}l-1.5-3.5"/>'


def car(iso):
    """A little iso hatchback at the origin (x forward), returned with its own projection."""
    out = []
    out.append(iso.poly([(-.1, -.36, 0), (1.25, -.36, 0), (1.25, .36, 0), (-.1, .36, 0)], "f-shadow"))
    out.append(iso.box(0, -.3, .14, 1.15, .3, .44, top="car-top", left="car-left", right="car-right"))
    out.append(iso.box(.28, -.26, .44, .82, .26, .7, top="car-top", left="car-glass", right="car-glass"))
    # wheels on the visible (+y) side
    for wx in (.25, .9):
        pts = []
        for k in range(16):
            t = 2 * math.pi * k / 16
            pts.append((wx + .16 * math.cos(t), .3, .14 + .16 * math.sin(t)))
        out.append(iso.poly(pts, "car-wheel"))
    return "".join(out)


def hatch_defs():
    return ""  # patterns live in index.html's sprite so they can be shared


# --------------------------------------------------------------------
# Hero diorama
# --------------------------------------------------------------------
def hero():
    iso = Iso(44)
    rng = random.Random(7)
    W, D, T = 12, 8, 0.85
    RY0, RY1 = 3.45, 4.55
    ground, back, front, sky, tags = [], [], [], [], []

    # Slab + strata line
    ground.append(iso.poly([(0, 0, 0), (0, D, 0), (0, D, -T), (0, 0, -T)], "f-left"))
    ground.append(iso.poly([(0, D, 0), (W, D, 0), (W, D, -T), (0, D, -T)], "f-right"))
    ground.append(iso.poly([(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], "f-ground"))
    ground.append(f'<polyline class="pen thin dash" points="{iso.pts((0, 0, -T*.45), (0, D, -T*.45), (W, D, -T*.45))}"/>')
    # road cut on the left face
    ground.append(iso.poly([(0, RY0, 0), (0, RY1, 0), (0, RY1, -.12), (0, RY0, -.12)], "f-road-side"))

    # Lake with ripples
    lake = [(4.6, 5.7), (6.9, 5.5), (7.6, 6.4), (7.1, 7.5), (5.0, 7.6), (4.3, 6.6)]
    ground.append(iso.poly([(x, y, 0) for x, y in lake], "f-water"))
    for (x0, y0, x1) in ((5.0, 6.2, 6.3), (5.6, 6.7, 7.0), (5.1, 7.15, 6.0)):
        ground.append(iso.line((x0, y0, 0), (x1, y0, 0), "pen thin water-line"))

    # Road
    ground.append(iso.poly([(0, RY0, 0), (W, RY0, 0), (W, RY1, 0), (0, RY1, 0)], "f-road"))
    ground.append(iso.line((0, RY0, 0), (W, RY0, 0)))
    ground.append(iso.line((0, RY1, 0), (W, RY1, 0)))
    ground.append(iso.line((0, (RY0 + RY1) / 2, 0), (W, (RY0 + RY1) / 2, 0), "pen road-dash"))

    # Cloud shadows on the ground

    # Grass ticks, avoiding things
    keep_out = [(0.4, 1.4, 3.2, 3.0), (2.0, 0.4, 3.2, 1.7), (8.0, 0.0, 12, 3.4), (4.2, 5.4, 7.8, 7.8),
                (0.5, 5.0, 1.9, 6.3), (0, RY0 - .25, W, RY1 + .25)]
    for _ in range(70):
        x, y = rng.uniform(.3, W - .3), rng.uniform(.3, D - .3)
        if any(a <= x <= c and b <= y <= d for a, b, c, d in keep_out):
            continue
        ground.append(iso.grass(x, y))

    # ---- objects behind the road (sorted back -> front by y - x) ----
    objs_back = [
        (2.2, 1.0, lambda: iso.tower(2.2, .6, 3.0, 1.45, 1.55)),
        (1.2, 2.2, lambda: iso.hip_house(.6, 1.6, 1.85, 2.8, .85, .55)),
        (3.7, 2.7, lambda: iso.round_tree(3.7, 2.7, 1.35)),
        (4.3, 1.2, lambda: iso.round_tree(4.3, 1.2, 1.5)),
        (5.3, 2.6, lambda: iso.pine(5.3, 2.6, 1.0)),
        (5.8, 1.3, lambda: iso.pine(5.8, 1.3, 1.25)),
        (6.5, 2.75, lambda: iso.pine(6.5, 2.75, .9)),
        (6.9, .8, lambda: iso.pine(6.9, .8, 1.1)),
        (7.3, 2.1, lambda: iso.pine(7.3, 2.1, 1.05)),
        (8.4, 1.2, lambda: iso.pyramid(7.6, .3, 9.2, 1.9, 1.7, cap=.3)),
        (9.8, 1.8, lambda: iso.pyramid(8.4, .3, 11.4, 3.2, 3.1, cap=.36)),
        (11.2, 2.6, lambda: iso.pyramid(10.4, 1.8, 11.9, 3.3, 1.5, cap=.32)),
    ]
    objs_back.sort(key=lambda o: o[1] - o[0])
    back = [f() for _, _, f in objs_back]

    objs_front = [
        (1.2, 5.6, lambda: iso.hip_house(.6, 5.05, 1.8, 6.15, .7, .5)),
        (2.6, 5.4, lambda: iso.round_tree(2.6, 5.5, 1.3)),
        (3.3, 6.9, lambda: iso.round_tree(3.3, 6.9, 1.45)),
        (8.3, 5.4, lambda: iso.pine(8.3, 5.4, .95)),
        (9.2, 6.8, lambda: iso.pine(9.2, 6.8, 1.15)),
        (10.3, 5.3, lambda: iso.pine(10.3, 5.3, 1.0)),
        (11.1, 6.5, lambda: iso.pine(11.1, 6.5, 1.2)),
        (10.0, 7.5, lambda: iso.pine(10.0, 7.5, .85)),
        (11.55, 4.85, lambda: iso.flag(11.55, 4.85, "flag-b")),
        (.25, 4.85, lambda: iso.flag(.25, 4.85, "flag-a", h=1.0)),
    ]
    objs_front.sort(key=lambda o: o[1] - o[0])
    front = [f() for _, _, f in objs_front]

    # ---- car, driving along the road (animated translate) ----
    lane = (RY0 + RY1) / 2 + .27
    car_iso = Iso(44, iso.ox, iso.oy)
    car_svg = car(car_iso)
    x_start, x_end = -.2, 10.6
    (sx, sy), (ex, ey) = iso.p(x_start, lane, 0), iso.p(x_end, lane, 0)
    (ox, oy) = iso.p(0, 0, 0)
    car_g = (f'<g class="car-wrap"><g class="car">'
             f'<animateTransform attributeName="transform" type="translate" dur="14s" repeatCount="indefinite" '
             f'values="{sx - ox:.1f} {sy - oy:.1f};{ex - ox:.1f} {ey - oy:.1f}" keyTimes="0;1" calcMode="linear"/>'
             f'<animate attributeName="opacity" dur="14s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.05;.93;1"/>'
             f'{car_svg}</g></g>')

    # ---- sky: three weather zones (start / middle / end of the drive) ----
    # Every zone has a drawing for each kind of weather; the app switches them to match the real
    # forecast for that third of the trip. The defaults tell the product story: sun, cloud, rain.
    def voxel_cloud(blocks, cls, drift):
        parts = []
        for b in sorted(blocks, key=lambda b: (b[2], b[1] - b[0])):
            parts.append(iso.box(*b, top="f-cloud", left="f-cloud", right=cls))
        return f'<g class="cloud {drift}">{"".join(parts)}</g>'

    def cloud_blocks(fp, z):
        x0, y0, x1, y1 = fp
        return [(x0, y0, z, x1, y1, z + .45),
                (x0 + .5, y0 + .2, z + .45, x1 - .6, y1 - .2, z + .9),
                (x0 + .9, y0 - .5, z + .2, x1 - 1.1, y0 + .3, z + .65)]

    def sun_svg(X, Y, r):
        rays = "".join(
            f'<line x1="{X + math.cos(a) * (r + 10):.1f}" y1="{Y + math.sin(a) * (r + 10):.1f}" x2="{X + math.cos(a) * (r + 24):.1f}" y2="{Y + math.sin(a) * (r + 24):.1f}"/>'
            for a in (i * math.pi / 6 for i in range(12)))
        iso.xs += [X - r - 26, X + r + 26]
        iso.ys += [Y - r - 26]
        return (f'<g class="sun"><g class="sun-rays pen" style="transform-origin:{X:.1f}px {Y:.1f}px">{rays}</g>'
                f'<circle class="sun-core" cx="{X:.1f}" cy="{Y:.1f}" r="{r}"/>'
                f'<path class="sun-shade" d="M{X + r * .35:.1f} {Y - r * .94:.1f}A{r} {r} 0 0 1 {X + r * .35:.1f} {Y + r * .94:.1f}A{r * .88:.1f} {r} 0 0 0 {X + r * .35:.1f} {Y - r * .94:.1f}Z"/></g>')

    def moon_svg(X, Y, r):
        stars = "".join(
            f'<path class="star-pen" d="M{X + dx:.1f} {Y + dy - 5:.1f}v10M{X + dx - 5:.1f} {Y + dy:.1f}h10"/>'
            for dx, dy in ((-r - 34, -10), (r + 30, -r - 6), (r + 46, r - 2), (-r - 12, r + 22)))
        return (f'<g class="moon">{stars}'
                f'<path class="moon-core" d="M{X + r * .45:.1f} {Y - r * .9:.1f}A{r} {r} 0 1 0 {X + r * .45:.1f} {Y + r * .9:.1f}A{r * .8:.1f} {r * .8:.1f} 0 1 1 {X + r * .45:.1f} {Y - r * .9:.1f}Z"/></g>')

    def rain_lines(fp, z, n=16):
        x0, y0, x1, y1 = fp
        out = []
        for _ in range(n):
            x, y = rng.uniform(x0 + .2, x1 - .2), rng.uniform(y0 + .1, y1 - .1)
            a, b = iso.p(x, y, z), iso.p(x, y, .25)
            out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" style="animation-delay:-{rng.uniform(0, 1):.2f}s"/>')
        return f'<g class="rain">{"".join(out)}</g>'

    def snow_flakes(fp, z, n=14):
        x0, y0, x1, y1 = fp
        out = []
        for _ in range(n):
            x, y, zz = rng.uniform(x0 + .2, x1 - .2), rng.uniform(y0 + .1, y1 - .1), rng.uniform(.6, z - .3)
            X, Y = iso.p(x, y, zz)
            out.append(f'<path class="flake" style="animation-delay:-{rng.uniform(0, 3):.2f}s" d="M{X:.1f} {Y - 4:.1f}v8M{X - 3.5:.1f} {Y - 2:.1f}l7 4M{X - 3.5:.1f} {Y + 2:.1f}l7-4"/>')
        return f'<g class="snow">{"".join(out)}</g>'

    def bolt(fp, z):
        cx, cy = (fp[0] + fp[2]) / 2, (fp[1] + fp[3]) / 2
        X, Y = iso.p(cx, cy, z)
        _, G = iso.p(cx, cy, .6)
        h = G - Y
        pts = [(X, Y), (X - 10, Y + h * .45), (X + 3, Y + h * .45), (X - 8, Y + h), (X + 14, Y + h * .38), (X + 1, Y + h * .38), (X + 9, Y)]
        return f'<polygon class="bolt" points="{" ".join(f"{a:.1f},{b:.1f}" for a, b in pts)}"/>'

    def fog_bands(fp):
        x0, y0, x1, y1 = fp
        x0, x1, y0, y1 = max(.05, x0 - .6), min(W - .05, x1 + .6), max(.05, y0 - 1.2), min(D - .05, y1 + 1.6)
        out = []
        for k, z in enumerate((.35, .8, 1.25)):
            out.append(iso.poly([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], "f-fog"))
            a, b = iso.p(x0 + .3, (y0 + y1) / 2 + k * .3, z), iso.p(x1 - .3, (y0 + y1) / 2 + k * .3, z)
            out.append(f'<line class="pen thin fog-line" style="animation-delay:-{k * 1.3:.1f}s" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
        return "".join(out)

    def shadow(fp, dense=False):
        x0, y0, x1, y1 = fp
        return iso.poly([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], "f-cloudshadow" + (" is-dense" if dense else ""))

    ZONES = {
        # name: (cloud footprint, cloud height, sun/moon position, default weather)
        'a': ((.9, .9, 3.3, 2.1), 3.6, iso.p(3.2, -.6, 5.3), 'sun'),
        'b': ((5.0, 2.3, 7.3, 3.4), 3.5, iso.p(6.6, .6, 5.9), 'cloud'),
        'c': ((9.0, 4.7, 11.6, 6.0), 4.1, iso.p(11.2, 3.2, 6.3), 'rain'),
    }
    for zname, (fp, z, (SX, SY), default) in ZONES.items():
        r = 34 if zname == 'a' else 28
        drift = 'drift-a' if zname != 'c' else 'drift-b'
        variants = {
            'sun': ('', sun_svg(SX, SY, r)),
            'moon': ('', moon_svg(SX, SY, r - 6)),
            'cloud': (shadow(fp), voxel_cloud(cloud_blocks(fp, z), "f-right", drift)),
            'rain': (shadow(fp, True), rain_lines(fp, z) + voxel_cloud(cloud_blocks(fp, z), "f-right-dark", drift)),
            'snow': (shadow(fp), snow_flakes(fp, z) + voxel_cloud(cloud_blocks(fp, z), "f-right", drift)),
            'storm': (shadow(fp, True), rain_lines(fp, z, 10) + bolt(fp, z) + voxel_cloud(cloud_blocks(fp, z), "f-right-dark", drift)),
            'fog': ('', fog_bands(fp)),
        }
        for kind, (g_svg, s_svg) in variants.items():
            on = ' on' if kind == default else ''
            attrs = f'class="wx-v{on}" data-zone="{zname}" data-kind="{kind}"'
            if g_svg:
                ground.append(f'<g {attrs}>{g_svg}</g>')
            sky.append(f'<g {attrs}>{s_svg}</g>')
    BX, BY = iso.p(5.2, -.2, 5.9)
    sky.append(f'<g class="birds pen"><path d="M{BX:.1f} {BY:.1f}q6-6 12 0q6-6 12 0"/>'
               f'<path d="M{BX + 34:.1f} {BY + 14:.1f}q4-4 8 0q4-4 8 0"/></g>')

    # ---- forecast tags pinned to the road ----
    def tag(x, z, text, cls="", w=112):
        a, b = iso.p(x, (RY0 + RY1) / 2, 0), iso.p(x, (RY0 + RY1) / 2, z)
        iso.ys.append(b[1] - 34)
        return (f'<g class="tag {cls}"><line class="pen thin dash" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>'
                f'<circle class="tag-dot" cx="{a[0]:.1f}" cy="{a[1]:.1f}" r="3.5"/>'
                f'<rect x="{b[0] - w/2:.1f}" y="{b[1] - 30:.1f}" width="{w}" height="30" rx="15"/>'
                f'<text x="{b[0]:.1f}" y="{b[1] - 10:.1f}" text-anchor="middle">{text}</text></g>')
    tags.append(tag(2.2, 2.6, "9:00 · 72°", "tag-1"))
    tags.append(tag(5.7, 2.3, "10:40 · 61°", "tag-2", 120))
    tags.append(tag(8.3, 4.6, "12:15 · Rain", "tag-3 tag-warn", 124))

    x, y, w, h = iso.bbox(14)
    body = "".join(ground + back + [car_g] + front + sky + tags)
    return (f'<svg class="iso" viewBox="{x:.0f} {y:.0f} {w:.0f} {h:.0f}" id="sceneSvg" role="img" '
            f'aria-label="Isometric pen drawing of a road crossing a landscape: sun over a town, clouds over a forest, rain over mountains">{body}</svg>')


# --------------------------------------------------------------------
# "How it works" vignettes
# --------------------------------------------------------------------
def tile(iso, W=4.2, D=3.2, T=.35):
    return (iso.poly([(0, 0, 0), (0, D, 0), (0, D, -T), (0, 0, -T)], "f-left") +
            iso.poly([(0, D, 0), (W, D, 0), (W, D, -T), (0, D, -T)], "f-right") +
            iso.poly([(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], "f-ground"))


def pin(iso, x, y, cls, letter):
    X, Y = iso.p(x, y, 0)
    top = Y - 34
    iso.ys.append(top - 12)
    return (f'<ellipse class="f-shadow" cx="{X:.1f}" cy="{Y:.1f}" rx="7" ry="3"/>'
            f'<path class="{cls}" d="M{X:.1f} {Y - 3:.1f}C{X - 4:.1f} {Y - 14:.1f} {X - 12:.1f} {top + 14:.1f} {X - 12:.1f} {top + 2:.1f}a12 12 0 0 1 24 0c0 12-8 21-12 {Y - 3 - top - 2:.1f}Z"/>'
            f'<text class="pin-t" x="{X:.1f}" y="{top + 6:.1f}" text-anchor="middle">{letter}</text>')


def step1():
    iso = Iso(26)
    out = [tile(iso)]
    out.append(iso.poly([(0, 1.25, 0), (4.2, 1.25, 0), (4.2, 1.95, 0), (0, 1.95, 0)], "f-road"))
    out.append(iso.line((0, 1.25, 0), (4.2, 1.25, 0)))
    out.append(iso.line((0, 1.95, 0), (4.2, 1.95, 0)))
    out.append(f'<line class="pen road-dash sa-draw" x1="{iso.p(0,1.6)[0]:.1f}" y1="{iso.p(0,1.6)[1]:.1f}" x2="{iso.p(4.2,1.6)[0]:.1f}" y2="{iso.p(4.2,1.6)[1]:.1f}"/>')
    out.append(iso.pine(1.6, .6, .9))
    out.append(iso.pine(2.4, .5, 1.1))
    out.append(iso.round_tree(2.7, 2.7, .9))
    out.append(pin(iso, .55, 1.6, "pin-a", "A"))
    out.append(pin(iso, 3.7, 1.6, "pin-b", "B"))
    x, y, w, h = iso.bbox(6)
    return f'<svg class="iso" viewBox="{x:.0f} {y:.0f} {w:.0f} {h:.0f}">{"".join(out)}</svg>'


def step2():
    iso = Iso(26)
    out = [tile(iso)]
    out.append(iso.poly([(0, 1.25, 0), (4.2, 1.25, 0), (4.2, 1.95, 0), (0, 1.95, 0)], "f-road"))
    out.append(iso.line((0, 1.25, 0), (4.2, 1.25, 0)))
    out.append(iso.line((0, 1.95, 0), (4.2, 1.95, 0)))
    out.append(iso.pine(.35, .5, .9))
    out.append(iso.pine(3.95, .55, 1.0))
    for i, (x, label) in enumerate(((.8, "9:00"), (2.1, "10:40"), (3.4, "12:15"))):
        a, b = iso.p(x, 1.6, 0), iso.p(x, 1.6, 1.9 + i * .35)
        out.append(f'<g class="sa-post" style="--k:{i}"><line class="pen" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>'
                   f'<rect class="sa-tag" x="{b[0] - 20:.1f}" y="{b[1] - 16:.1f}" width="40" height="16" rx="8"/>'
                   f'<text class="sa-t" x="{b[0]:.1f}" y="{b[1] - 4.8:.1f}" text-anchor="middle">{label}</text></g>')
    x, y, w, h = iso.bbox(6)
    return f'<svg class="iso" viewBox="{x:.0f} {y:.0f} {w:.0f} {h:.0f}">{"".join(out)}</svg>'


def step3():
    iso = Iso(26)
    out = [tile(iso, 4.6, 2.6)]
    heights = [1.1, 1.6, 2.4, 1.7, .9, .6]
    for i, h in reversed(list(enumerate(heights))):
        x0 = .35 + i * .7
        best = i == 2
        out.append(f'<g class="sa-bar" style="--k:{i}">' + iso.box(x0, .9, 0, x0 + .45, 1.5, h,
                   top="bar-top" if best else "f-top", left="bar-left" if best else "f-left",
                   right="bar-right" if best else "f-right") + '</g>')
    X, Y = iso.p(.35 + 2 * .7 + .22, 1.2, 2.4)
    out.append(f'<path class="star" d="M{X:.1f} {Y - 20:.1f}l3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3.1-5.9 3.1 1.1-6.4-4.7-4.6 6.5-1Z"/>')
    iso.ys.append(Y - 22)
    x, y, w, h = iso.bbox(6)
    return f'<svg class="iso" viewBox="{x:.0f} {y:.0f} {w:.0f} {h:.0f}">{"".join(out)}</svg>'


def inject(html, name, svg):
    pat = re.compile(rf'(<!-- art:{name} -->).*?(<!-- /art:{name} -->)', re.S)
    assert pat.search(html), name
    return pat.sub(lambda m: m.group(1) + svg + m.group(2), html)


if __name__ == "__main__":
    path = ROOT / "index.html"
    html = path.read_text()
    for name, fn in (("hero", hero), ("step1", step1), ("step2", step2), ("step3", step3)):
        html = inject(html, name, fn())
    path.write_text(html)
    print("art injected")
