# AMSAT Tracker 📡

A lightweight, browser-based **amateur radio satellite tracker** powered by the
[N2YO REST API](https://www.n2yo.com/api/). Pick your home location, choose the
birds you care about, watch them live on a map with their ground footprints, and
pull **10-day pass predictions** for your exact position.

Runs as a tiny static site inside an nginx Docker container on **port 8585**.

## Features

- **Home location** – manual lat/lon/alt entry or one-click browser geolocation.
  Saved in `localStorage`; nothing leaves your browser.
- **Satellite picker** – curated list of popular amateur-radio satellites (ISS,
  SO-50, AO-91, FO-29, RS-44, the XW/CAS series, NOAA/METEOR weather birds, …)
  with bands and short descriptions. Your selection is persisted.
- **Live tracking on a map** – an interactive Leaflet map shows each tracked
  satellite's sub-satellite point, its visibility **ground footprint** (0°
  horizon circle) and its ground track. A table lists azimuth, elevation,
  altitude, slant range, footprint radius and above/below-horizon status.
- **10-day pass predictions** – per-satellite tables of rise/max/set times,
  azimuths, max elevation and duration, with a configurable minimum elevation.
  Click the 🗺 button on any pass to plot that pass's ground track and the
  visibility footprints at rise, max and set on the map.
- **Local orbit propagation** – N2YO TLEs are propagated in the browser with
  SGP4 (`satellite.js`), so live positions, ground tracks and footprints need no
  extra API calls (only one TLE request per satellite per session).
- **API key stays yours** – you paste your own free N2YO key; it is stored only
  in your browser's `localStorage`.

## Quick start (Docker)

```bash
docker compose up --build -d
```

Then open **http://localhost:8585**.

Plain Docker without compose:

```bash
docker build -t amsat-tracker .
docker run -d --name amsat-tracker -p 8585:8585 --restart unless-stopped amsat-tracker
```

## Getting an N2YO API key

1. Register / request a free key at <https://www.n2yo.com/api/>.
2. Paste it into the **N2YO API key** field in the top-right of the app and
   click **Save**.

The app calls the API through a same-origin reverse proxy (`/api/n2yo/…`)
configured in `nginx.conf`, which sidesteps browser CORS restrictions. If you
open the files without the Docker container, the app automatically falls back to
calling `https://api.n2yo.com` directly.

> The N2YO free tier has a limited number of transactions per hour. Live tracking
> only needs one TLE request per satellite per session (orbits are propagated
> locally); pass predictions cost one request per satellite per load.

## Map tiles

The map library (Leaflet) and the SGP4 library (satellite.js) are vendored under
`vendor/` so the container is self-contained. Map **tiles** are loaded at runtime
from OpenStreetMap, which requires internet access in the browser (the N2YO API
needs it anyway). A ☀️/🌙 control toggles a CSS dark filter over the tiles, so no
API-keyed tile provider is needed.

## Project layout

```
index.html      Markup / layout
styles.css      Dark responsive theme
app.js          Application logic (location, selection, tracking, passes, map)
satellites.js   Curated satellite list (NORAD IDs)
nginx.conf      nginx site + N2YO reverse proxy (port 8585)
Dockerfile      nginx:alpine image
docker-compose.yml
vendor/         Vendored Leaflet + satellite.js (SGP4)
```

## Notes

- Satellite availability changes over time (some listed birds are
  decommissioned). The list is a convenience default, not a live status feed.
- Pass predictions use the `radiopasses` endpoint (great for amateur radio), with
  a maximum horizon of 10 days as imposed by N2YO.

Data © [N2YO.com](https://www.n2yo.com/).
