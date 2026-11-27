# Weather to Travel

**The forecast for your whole drive.** Pick a start, a destination and a departure time. Weather to Travel finds the route, works out when you'll reach each town along it, and pulls that town's forecast for that hour. Then it scores the drive and shows the best time to leave in the next 72 hours.

A ground-up rebuild of the original [Weather-to-travel](https://github.com/mykolyn/Weather-to-travel) bootcamp project.

## What it does

- **Arrival-time forecasts.** The route is split into up to 15 checkpoints. Each one is matched to the hourly forecast for the moment you'll pass through it.
- **Road score (0–100).** Rain, snow, ice (freezing temps plus moisture), thunderstorms, fog and visibility, and wind gusts are combined into one score with a plain-language verdict.
- **When to leave.** A 72-hour bar chart scores every possible departure hour. Tap a bar, or use the arrow keys, to re-plan instantly. No new network calls are needed.
- **Heads-up and packing.** Ice risk, storms, crosswinds, big temperature swings, night driving, "bring a jacket", and so on.
- **Live map.** The route is coloured by the weather along each stretch, with temperature pins and popups. The map is linked to the timeline in both directions.
- **Shareable links.** Every plan is encoded in the URL.
- **Quality of life.** °F/°C toggle, light and dark mode, recent trips, "use my location", keyboard-accessible place search, and reduced-motion support.

## Data (all free, no API keys)

| Purpose | Service |
| --- | --- |
| Place search & town names | [Photon](https://photon.komoot.io/) (OpenStreetMap), with [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) as a fallback |
| Driving route + per-segment travel time | [OSRM](https://project-osrm.org/) public server |
| Hourly forecast (8 days, many points in one request) | [Open-Meteo](https://open-meteo.com/) |
| Basemap | [OpenFreeMap](https://openfreemap.org/) vector tiles via [MapLibre GL JS](https://maplibre.org/) |

The original app hard-coded Google and OpenWeather keys and relied on the now-defunct `cors-anywhere` proxy. This version has no secrets and no backend.

## Design

- **Type:** *Bricolage Grotesque* for display (a variable grotesque whose width and optical size are tuned per use), *Instrument Sans* for UI and body text, and *JetBrains Mono* for times, temperatures and data, styled like an instrument cluster.
- **Colour:** warm paper and ink, one signal orange (road-sign hi-vis), and a weather spectrum (sun, cloud, fog, rain, snow/ice, storm) used the same way on the map, the timeline and the glyphs.
- **Icons and motion:** a hand-built animated SVG weather glyph set (rays turn, rain falls, lightning flickers), a UI icon sprite, an illustrated hero scene (one road with three skies), the route drawing itself on the map, a count-up road score and staggered reveals. All motion respects `prefers-reduced-motion`.

## Run it

It's a static site with no build step.

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

To deploy, enable **GitHub Pages** in the repo settings (source: branch root). The `.nojekyll` file is already in place.

## Structure

```
index.html            markup, UI icon sprite, hero illustration
assets/css/styles.css design tokens, layout, motion, light/dark themes
assets/js/api.js      Photon / OSRM / Open-Meteo clients
assets/js/model.js    route sampling, ETA → forecast lookup, hazard scoring
assets/js/icons.js    animated weather glyphs
assets/js/app.js      UI: planner, results, optimizer, timeline, map
```

## Original team

[Hebah](https://github.com/HebahM) · [Jennifer](https://github.com/jenniferchan2267) · [Michael](https://github.com/mykolyn) · [Tyler](https://github.com/tsully1990)

*Drive times exclude stops and traffic. Always check official road conditions before you travel.*
