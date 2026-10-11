"use strict";

/* =========================================================================
 * AMSAT Tracker — vanilla JS front-end for the N2YO REST API.
 *
 * API endpoints used:
 *   tle           /rest/v1/satellite/tle/{id}
 *   radiopasses   /rest/v1/satellite/radiopasses/{id}/{lat}/{lng}/{alt}/{days}/{minEl}
 *
 * Orbits are propagated locally with SGP4 (satellite.js) from N2YO TLEs, so
 * live positions, ground tracks and pass footprints are computed in the
 * browser without extra API calls. The map is Leaflet.
 *
 * The app prefers a same-origin nginx reverse proxy at /api/n2yo (avoids CORS)
 * and transparently falls back to https://api.n2yo.com when opened elsewhere.
 * ========================================================================= */

const LS = {
  key: "amsat.apiKey",
  loc: "amsat.location",
  sel: "amsat.selected",
};

const PROXY_BASE = "/api/n2yo";
const DIRECT_BASE = "https://api.n2yo.com";
let resolvedBase = null; // cached working base URL

const EARTH_R = 6371.0; // mean Earth radius, km

const SAT_COLORS = [
  "#4f8cff", "#22d3a6", "#ffb020", "#ff6b6b", "#c084fc", "#38bdf8",
  "#f472b6", "#a3e635", "#fb923c", "#2dd4bf", "#818cf8", "#facc15",
];

const state = {
  location: null,          // { lat, lng, alt }
  selected: [],            // array of NORAD ids
  satrecs: new Map(),      // id -> SGP4 satrec
  live: new Map(),         // id -> { marker, circle, track, cur }
  passesById: new Map(),   // id -> array of passes
  trackTimer: null,
  animHandle: null,
  map: null,
  liveLayer: null,
  passLayer: null,
  observerLayer: null,
};

/* ------------------------------------------------------------------ utils */

const $ = (id) => document.getElementById(id);

function toast(msg, kind = "", ms = 3200) {
  const el = $("toast");
  el.className = "toast show " + kind;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = "toast " + kind), ms);
}

function setStatus(el, text, kind = "") {
  el.className = "pill " + kind;
  el.textContent = text;
}

function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function pad(n) { return String(n).padStart(2, "0"); }

function fmtUTC(unix) {
  const d = new Date(unix * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function fmtLocalDate(unix) {
  return new Date(unix * 1000).toLocaleString();
}

function compass(az) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((az % 360) / 22.5)) % 16];
}

function duration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${pad(s)}s`;
}

function satById(id) {
  return (window.AMSAT_SATELLITES || []).find((s) => s.id === Number(id));
}

function colorFor(id) {
  const idx = state.selected.indexOf(Number(id));
  return SAT_COLORS[(idx < 0 ? 0 : idx) % SAT_COLORS.length];
}

/* --------------------------------------------------------------- storage */

function loadPrefs() {
  try {
    const rawLoc = localStorage.getItem(LS.loc);
    if (rawLoc) state.location = JSON.parse(rawLoc);
    const rawSel = localStorage.getItem(LS.sel);
    if (rawSel) state.selected = JSON.parse(rawSel);
    const k = localStorage.getItem(LS.key);
    if (k) $("apiKey").value = k;
  } catch (e) {
    console.warn("Failed to read local storage", e);
  }
}

function saveSelected() {
  localStorage.setItem(LS.sel, JSON.stringify(state.selected));
}

function getKey() {
  return ($("apiKey").value || "").trim();
}

/* ------------------------------------------------------------- API layer */

function buildUrl(path, params, base) {
  const q = new URLSearchParams(params);
  return `${base}${path}?${q.toString()}`;
}

async function apiFetch(path, params) {
  const key = getKey();
  if (!key) throw new Error("Missing N2YO API key. Add it at the top-right.");
  params = { ...params, apiKey: key };

  const bases = resolvedBase ? [resolvedBase] : [PROXY_BASE, DIRECT_BASE];
  let lastErr;
  for (const base of bases) {
    try {
      const res = await fetch(buildUrl(path, params, base));
      if (!res.ok) {
        lastErr = new Error(`N2YO HTTP ${res.status}`);
        if (base === PROXY_BASE) continue;
        throw lastErr;
      }
      const data = await res.json();
      if (data && data.error) {
        const e = new Error(data.error);
        if (base === PROXY_BASE) { lastErr = e; continue; }
        throw e;
      }
      resolvedBase = base;
      return data;
    } catch (err) {
      lastErr = err;
      if (resolvedBase) break;
    }
  }
  throw lastErr || new Error("Request failed");
}

async function fetchTle(satId) {
  const data = await apiFetch(`/rest/v1/satellite/tle/${satId}`, {});
  const raw = (data.tle || "").trim();
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("Invalid TLE from N2YO");
  const satrec = window.satellite.twoline2satrec(lines[0], lines[1]);
  return { satrec, name: (data.info && data.info.satname) || satById(satId)?.name || `#${satId}` };
}

async function fetchRadioPasses(satId, days, minEl) {
  const { lat, lng, alt } = state.location;
  return apiFetch(
    `/rest/v1/satellite/radiopasses/${satId}/${lat}/${lng}/${alt}/${days}/${minEl}`,
    {}
  );
}

// Fetch (and cache) the SGP4 record for a satellite.
async function ensureSatrec(id) {
  if (state.satrecs.has(id)) return state.satrecs.get(id);
  const { satrec } = await fetchTle(id);
  state.satrecs.set(id, satrec);
  return satrec;
}

/* ------------------------------------------------------ orbital geometry */

function observerGd() {
  const { lat, lng, alt } = state.location;
  return {
    latitude: window.satellite.degreesToRadians(lat),
    longitude: window.satellite.degreesToRadians(lng),
    height: (alt || 0) / 1000, // km
  };
}

// Sub-satellite point + altitude for a given date.
function propagateAt(satrec, date) {
  let pv;
  try { pv = window.satellite.propagate(satrec, date); } catch (e) { return null; }
  if (!pv || !pv.position) return null;
  const gmst = window.satellite.gstime(date);
  const gd = window.satellite.eciToGeodetic(pv.position, gmst);
  return {
    lat: window.satellite.degreesLat(gd.latitude),
    lng: window.satellite.degreesLong(gd.longitude),
    altKm: gd.height,
    positionEci: pv.position,
    gmst,
  };
}

// Azimuth / elevation / range from the observer to the satellite.
function lookAnglesAt(satrec, date, obs) {
  let pv;
  try { pv = window.satellite.propagate(satrec, date); } catch (e) { return null; }
  if (!pv || !pv.position) return null;
  const gmst = window.satellite.gstime(date);
  const ecf = window.satellite.eciToEcf(pv.position, gmst);
  const la = window.satellite.ecfToLookAngles(obs, ecf);
  return {
    az: window.satellite.radiansToDegrees(la.azimuth),
    el: window.satellite.radiansToDegrees(la.elevation),
    range: la.rangeSat,
  };
}

// Radius on the ground of the region from which the satellite is visible
// above a minimum elevation.
function footprintRadiusKm(altKm, minElDeg = 0) {
  const minEl = minElDeg * Math.PI / 180;
  const ratio = (EARTH_R / (EARTH_R + altKm)) * Math.cos(minEl);
  const central = Math.acos(Math.min(1, Math.max(-1, ratio))) - minEl;
  return EARTH_R * central;
}

// Ground track as [lat, lng] points between two epoch-ms values.
function groundTrack(satrec, startMs, endMs, stepSec) {
  const pts = [];
  for (let t = startMs; t <= endMs; t += stepSec * 1000) {
    const p = propagateAt(satrec, new Date(t));
    if (p) pts.push([p.lat, p.lng]);
  }
  return pts;
}

// Split a track at the ±180° antimeridian so Leaflet does not draw a
// wrap-around line across the whole map.
function splitDateline(pts) {
  if (pts.length < 2) return [pts];
  const segs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][1] - pts[i - 1][1]) > 180) segs.push([]);
    segs[segs.length - 1].push(pts[i]);
  }
  return segs.filter((s) => s.length > 1);
}

/* ------------------------------------------------------------- map setup */

function initMap() {
  const map = L.map("map", { worldCopyJump: true, minZoom: 1, zoomControl: true })
    .setView([20, 0], 2);

  // OpenStreetMap tiles need no API key. A CSS filter darkens them for the
  // dark UI, so no keyed tile provider is required.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  map.getContainer().classList.add("dark-tiles");

  const ThemeControl = L.Control.extend({
    options: { position: "topright" },
    onAdd(m) {
      const btn = L.DomUtil.create("button", "map-theme-btn");
      btn.innerHTML = "☀️";
      btn.title = "Toggle dark / light map";
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        const dark = m.getContainer().classList.toggle("dark-tiles");
        btn.innerHTML = dark ? "☀️" : "🌙";
      });
      return btn;
    },
  });
  map.addControl(new ThemeControl());

  state.map = map;
  state.passLayer = L.layerGroup().addTo(map);
  state.liveLayer = L.layerGroup().addTo(map);
  state.observerLayer = L.layerGroup().addTo(map);
}

function updateObserverOnMap() {
  if (!state.observerLayer) return;
  state.observerLayer.clearLayers();
  if (!state.location) return;
  const { lat, lng } = state.location;
  L.circleMarker([lat, lng], {
    radius: 7, color: "#0b1020", weight: 2, fillColor: "#ffb020", fillOpacity: 1,
  }).bindTooltip("Home", { permanent: false }).addTo(state.observerLayer);
  L.circle([lat, lng], {
    radius: 30000, color: "#ffb020", weight: 1, opacity: 0.55, fill: false,
  }).addTo(state.observerLayer);
}

function satIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 9px ${color};border:2px solid rgba(255,255,255,.85)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/* ------------------------------------------------------------ location UI */

function applyLocation(loc) {
  $("lat").value = loc.lat;
  $("lng").value = loc.lng;
  $("alt").value = loc.alt ?? 0;
  setStatus($("locStatus"), `${fmt(loc.lat, 4)}, ${fmt(loc.lng, 4)}`, "ok");
}

function saveLocation() {
  const lat = parseFloat($("lat").value);
  const lng = parseFloat($("lng").value);
  const alt = parseFloat($("alt").value) || 0;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return toast("Enter a valid latitude (-90..90)", "err");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return toast("Enter a valid longitude (-180..180)", "err");
  state.location = { lat, lng, alt };
  localStorage.setItem(LS.loc, JSON.stringify(state.location));
  applyLocation(state.location);
  updateObserverOnMap();
  if (state.map) state.map.setView([lat, lng], Math.max(state.map.getZoom(), 5));
  updateButtons();
  toast("Location saved", "ok");
}

function useGeolocation() {
  if (!navigator.geolocation) return toast("Geolocation not supported", "err");
  setStatus($("locStatus"), "Locating…", "warn");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        alt: Math.round(pos.coords.altitude || 0),
      };
      localStorage.setItem(LS.loc, JSON.stringify(state.location));
      applyLocation(state.location);
      updateObserverOnMap();
      if (state.map) state.map.setView([state.location.lat, state.location.lng], 6);
      updateButtons();
      toast("Location set from device", "ok");
    },
    (err) => {
      setStatus($("locStatus"), "Location error", "err");
      toast("Geolocation failed: " + err.message, "err");
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

/* ----------------------------------------------------------- satellite UI */

function renderSatList(filter = "") {
  const list = $("satList");
  const f = filter.trim().toLowerCase();
  list.innerHTML = "";
  (window.AMSAT_SATELLITES || [])
    .filter((s) => !f || s.name.toLowerCase().includes(f) || String(s.id).includes(f))
    .forEach((s) => {
      const li = document.createElement("li");
      const checked = state.selected.includes(s.id) ? "checked" : "";
      li.innerHTML = `
        <label class="sat-item">
          <input type="checkbox" data-id="${s.id}" ${checked} />
          <span class="sat-meta">
            <span class="sat-name">${s.name}</span>
            <span class="sat-desc">${s.desc} · NORAD ${s.id}</span>
          </span>
          <span class="sat-band">${s.band} MHz</span>
        </label>`;
      list.appendChild(li);
    });
  if (!list.children.length) {
    list.innerHTML = `<li><div class="empty">No satellites match “${filter}”.</div></li>`;
  }
}

function onSatToggle(e) {
  const cb = e.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const id = Number(cb.dataset.id);
  if (cb.checked) {
    if (!state.selected.includes(id)) state.selected.push(id);
  } else {
    state.selected = state.selected.filter((x) => x !== id);
  }
  saveSelected();
  updateCount();
  updateButtons();
  if (state.trackTimer) syncLive();
  else updateTrackTable([]);
}

function updateCount() {
  $("selCount").textContent = state.selected.length;
}

function updateButtons() {
  const ready = !!state.location && state.selected.length > 0;
  $("trackToggle").disabled = !ready && !state.trackTimer;
  $("passBtn").disabled = !ready;
}

/* ------------------------------------------------------------- tracking  */

function addLiveLayer(id) {
  const col = colorFor(id);
  const marker = L.marker([0, 0], { icon: satIcon(col), zIndexOffset: 1000 })
    .bindTooltip(satById(id)?.name || String(id))
    .addTo(state.liveLayer);
  const circle = L.circle([0, 0], {
    radius: 1, color: col, weight: 1, opacity: 0.8, fillColor: col, fillOpacity: 0.12,
  }).addTo(state.liveLayer);
  const track = L.polyline([], { color: col, weight: 2, opacity: 0.65 })
    .addTo(state.liveLayer);
  state.live.set(id, { marker, circle, track, cur: null });
}

async function startTracking() {
  if (!state.location) return toast("Set your location first", "err");
  if (!state.selected.length) return toast("Select at least one satellite", "err");
  if (!getKey()) return toast("Enter your N2YO API key first", "err");

  setStatus($("trackStatus"), "Fetching TLEs…", "warn");
  $("trackToggle").textContent = "Stop";
  $("trackToggle").onclick = stopTracking;
  $("trackToggle").disabled = false;

  try {
    await Promise.all(state.selected.map((id) => ensureSatrec(id)));
  } catch (e) {
    toast("Could not fetch TLEs: " + e.message, "err");
    setStatus($("trackStatus"), "TLE error", "err");
    stopTracking();
    return;
  }

  state.live.clear();
  state.liveLayer.clearLayers();
  state.selected.forEach((id) => addLiveLayer(id));

  updateGroundTracks();
  animate();
  state.trackTimer = setInterval(updateGroundTracks, 5000);
  setStatus($("trackStatus"), `Tracking ${state.live.size}`, "ok");
}

function stopTracking() {
  clearInterval(state.trackTimer);
  state.trackTimer = null;
  if (state.animHandle) cancelAnimationFrame(state.animHandle);
  state.animHandle = null;
  state.live.clear();
  if (state.liveLayer) state.liveLayer.clearLayers();
  setStatus($("trackStatus"), "Idle");
  $("trackToggle").textContent = "Start";
  $("trackToggle").onclick = startTracking;
  updateTrackTable([]);
  updateButtons();
}

async function syncLive() {
  // remove deselected
  for (const id of [...state.live.keys()]) {
    if (!state.selected.includes(id)) {
      const l = state.live.get(id);
      state.liveLayer.removeLayer(l.marker);
      state.liveLayer.removeLayer(l.circle);
      state.liveLayer.removeLayer(l.track);
      state.live.delete(id);
    }
  }
  const added = state.selected.filter((id) => !state.live.has(id));
  if (added.length) {
    try {
      await Promise.all(added.map((id) => ensureSatrec(id)));
    } catch (e) {
      toast("Could not fetch TLE: " + e.message, "err");
      return;
    }
    added.forEach((id) => addLiveLayer(id));
    updateGroundTracks();
  }
  setStatus($("trackStatus"), `Tracking ${state.live.size}`, "ok");
}

function updateGroundTracks() {
  const now = Date.now();
  const start = now - 45 * 60 * 1000;
  const end = now + 45 * 60 * 1000;
  for (const [id, layer] of state.live) {
    const satrec = state.satrecs.get(id);
    if (!satrec) continue;
    const segs = splitDateline(groundTrack(satrec, start, end, 60));
    layer.track.setLatLngs(segs);
  }
}

function animate() {
  const now = new Date();
  const obs = observerGd();
  const rows = [];
  for (const [id, layer] of state.live) {
    const satrec = state.satrecs.get(id);
    if (!satrec) continue;
    const p = propagateAt(satrec, now);
    if (!p) continue;
    const la = lookAnglesAt(satrec, now, obs);
    layer.cur = { ...p, ...(la || {}) };
    layer.marker.setLatLng([p.lat, p.lng]);
    const fr = footprintRadiusKm(p.altKm, 0);
    layer.circle.setLatLng([p.lat, p.lng]);
    layer.circle.setRadius(fr * 1000);
    layer._footprint = fr;
    rows.push({ id, layer, p, la });
  }
  if (Date.now() - (animate._lastTable || 0) > 1000) {
    updateTrackTable(rows);
    animate._lastTable = Date.now();
  }
  state.animHandle = requestAnimationFrame(animate);
}

function updateTrackTable(rows) {
  const tbody = document.querySelector("#trackTable tbody");
  tbody.innerHTML = "";
  if (!state.live.size) {
    state.selected.forEach((id) => {
      const sat = satById(id);
      if (!sat) return;
      tbody.insertAdjacentHTML("beforeend",
        `<tr><td><span class="dot" style="background:${colorFor(id)}"></span>${sat.name}</td>
         <td colspan="6" class="tag-down">not tracking</td></tr>`);
    });
    return;
  }
  rows.sort((a, b) => (b.la?.el ?? -99) - (a.la?.el ?? -99));
  for (const { id, layer, p, la } of rows) {
    const up = (la?.el ?? -1) > 0;
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><span class="dot" style="background:${colorFor(id)}"></span>${satById(id)?.name || id}</td>
        <td class="num">${la ? fmt(la.az, 1) + "° " + compass(la.az) : "—"}</td>
        <td class="num">${la ? fmt(la.el, 1) + "°" : "—"}</td>
        <td class="num">${fmt(p.altKm, 0)}</td>
        <td class="num">${la ? fmt(la.range, 0) : "—"}</td>
        <td class="num">${fmt(layer._footprint, 0)}</td>
        <td>${up ? '<span class="tag-up">above horizon</span>' : '<span class="tag-down">below horizon</span>'}</td>
      </tr>`);
  }
}

/* ------------------------------------------------------------- passes    */

async function loadPasses() {
  if (!state.location) return toast("Set your location first", "err");
  if (!state.selected.length) return toast("Select at least one satellite", "err");
  const minEl = Math.max(0, Math.min(90, parseInt($("minEl").value, 10) || 0));

  $("passBtn").disabled = true;
  setStatus($("passStatus"), "Loading…", "warn");
  const box = $("passResults");
  box.innerHTML = `<p class="hint"><span class="spinner"></span>Fetching 10-day predictions for ${state.selected.length} satellite(s)…</p>`;

  const results = [];
  let ok = 0, fail = 0;
  state.passesById.clear();
  for (const id of state.selected) {
    const sat = satById(id);
    if (!sat) continue;
    try {
      const data = await fetchRadioPasses(id, 10, minEl);
      const passes = data.passes || [];
      state.passesById.set(id, passes);
      results.push({ sat, passes });
      ok++;
    } catch (e) {
      results.push({ sat, passes: [], error: e.message });
      fail++;
    }
  }

  renderPasses(results);
  setStatus($("passStatus"), fail ? `${ok} ok, ${fail} failed` : `${ok} loaded`, fail ? "warn" : "ok");
  $("passBtn").disabled = state.selected.length === 0 || !state.location;
}

function renderPasses(results) {
  const box = $("passResults");
  box.innerHTML = "";
  if (!results.length) {
    box.innerHTML = `<p class="empty">No satellites selected.</p>`;
    return;
  }
  results
    .sort((a, b) => (a.passes[0]?.startUTC || Infinity) - (b.passes[0]?.startUTC || Infinity))
    .forEach(({ sat, passes, error }) => {
      const card = document.createElement("div");
      card.className = "pass-card";

      if (error) {
        card.innerHTML = `<h3>${sat.name} <span class="count tag-down">error: ${error}</span></h3>`;
        box.appendChild(card);
        return;
      }
      if (!passes.length) {
        card.innerHTML = `<h3>${sat.name} <span class="count">no passes in next 10 days</span></h3>`;
        box.appendChild(card);
        return;
      }

      const rows = passes.map((p, i) => `
        <tr>
          <td class="num">${fmtUTC(p.startUTC)}</td>
          <td class="num">${fmtLocalDate(p.startUTC)}</td>
          <td class="num">${p.startAzCompass || compass(p.startAz)} (${fmt(p.startAz, 0)}°)</td>
          <td class="num"><strong>${fmt(p.maxEl, 1)}°</strong></td>
          <td class="num">${p.maxAzCompass || compass(p.maxAz)} (${fmt(p.maxAz, 0)}°)</td>
          <td class="num">${p.endAzCompass || compass(p.endAz)} (${fmt(p.endAz, 0)}°)</td>
          <td class="num">${duration(p.endUTC - p.startUTC)}</td>
          <td><button class="btn ghost tiny map-pass" data-sat="${sat.id}" data-idx="${i}" title="Show ground track &amp; footprint on map">🗺</button></td>
        </tr>`).join("");

      card.innerHTML = `
        <h3>${sat.name} — ${sat.band} MHz <span class="count">${passes.length} pass(es)</span></h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Start (UTC)</th><th>Start (local)</th><th>Rise az</th><th>Max el</th><th>Max az</th><th>Set az</th><th>Duration</th><th>Map</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      box.appendChild(card);
    });
}

// Draw the ground track and visibility footprints for one predicted pass.
async function showPassOnMap(satId, idx) {
  const sat = satById(satId);
  const passes = state.passesById.get(satId) || [];
  const pass = passes[idx];
  if (!sat || !pass) return;

  setStatus($("passStatus"), `Plotting ${sat.name}…`, "warn");
  try {
    await ensureSatrec(satId);
  } catch (e) {
    setStatus($("passStatus"), "TLE error", "err");
    return toast("Could not fetch TLE: " + e.message, "err");
  }

  const satrec = state.satrecs.get(satId);
  const col = colorFor(satId);
  state.passLayer.clearLayers();

  const startMs = pass.startUTC * 1000;
  const endMs = pass.endUTC * 1000;
  const pts = groundTrack(satrec, startMs, endMs, 15);
  const segs = splitDateline(pts);
  L.polyline(segs, { color: col, weight: 3, opacity: 0.95 }).addTo(state.passLayer);

  const marks = [
    ["rise", pass.startUTC],
    ["max", pass.maxUTC],
    ["set", pass.endUTC],
  ];
  for (const [label, t] of marks) {
    const p = propagateAt(satrec, new Date(t * 1000));
    if (!p) continue;
    const fr = footprintRadiusKm(p.altKm, 0);
    L.circle([p.lat, p.lng], {
      radius: fr * 1000, color: col, weight: 1, opacity: 0.8,
      fillColor: col, fillOpacity: label === "max" ? 0.16 : 0.08,
    }).bindTooltip(`${label} footprint · ${fmtUTC(t)} · ${fmt(fr, 0)} km`).addTo(state.passLayer);
    L.circleMarker([p.lat, p.lng], {
      radius: label === "max" ? 5 : 3, color: "#0b1020", weight: 1,
      fillColor: col, fillOpacity: 1,
    }).bindTooltip(`${label} · ${fmtUTC(t)}`).addTo(state.passLayer);
  }

  const bounds = L.latLngBounds(pts);
  if (bounds.isValid()) state.map.fitBounds(bounds.pad(0.25));
  setStatus($("passStatus"), `${sat.name} pass plotted`, "ok");
}

/* ------------------------------------------------------------- wiring    */

function saveKey() {
  const k = getKey();
  if (!k) {
    localStorage.removeItem(LS.key);
    toast("API key cleared");
    return;
  }
  localStorage.setItem(LS.key, k);
  resolvedBase = null;
  toast("API key saved", "ok");
}

function init() {
  loadPrefs();
  initMap();
  renderSatList();
  updateCount();
  updateButtons();
  if (state.location) {
    applyLocation(state.location);
    updateObserverOnMap();
    state.map.setView([state.location.lat, state.location.lng], 5);
  }
  updateTrackTable([]);

  $("saveKey").onclick = saveKey;
  $("toggleKey").onclick = () => {
    const i = $("apiKey");
    i.type = i.type === "password" ? "text" : "password";
  };

  $("saveLoc").onclick = saveLocation;
  $("geoBtn").onclick = useGeolocation;

  $("satList").addEventListener("change", onSatToggle);
  $("satSearch").addEventListener("input", (e) => renderSatList(e.target.value));
  $("selectAll").onclick = () => {
    state.selected = (window.AMSAT_SATELLITES || []).map((s) => s.id);
    saveSelected(); renderSatList($("satSearch").value); updateCount(); updateButtons();
    if (state.trackTimer) syncLive();
  };
  $("selectNone").onclick = () => {
    state.selected = [];
    saveSelected(); renderSatList($("satSearch").value); updateCount(); updateButtons();
    if (state.trackTimer) syncLive();
  };

  $("trackToggle").onclick = startTracking;
  $("clearMap").onclick = () => state.passLayer.clearLayers();

  $("passBtn").onclick = loadPasses;
  $("passResults").addEventListener("click", (e) => {
    const btn = e.target.closest(".map-pass");
    if (!btn) return;
    showPassOnMap(Number(btn.dataset.sat), Number(btn.dataset.idx));
  });
}

document.addEventListener("DOMContentLoaded", init);
