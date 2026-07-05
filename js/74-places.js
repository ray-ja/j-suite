/* ---------- PLACES — saved non-customer locations (transfer station, vendors, suppliers, quarry) ----------
   Lives on the ALREADY-synced `places` collection (map pins js/19 + sales route js/24 read the SAME records via
   name/lat/lng/owner/notes — those fields are UNTOUCHED). This surface ADDS three optional fields, additive +
   default-absent (no new collection, no migration backfill needed): `address`, `category`
   ("vendor"|"disposal"|"supplier"|"other"), `manualMiles` (one-way road miles from home base — the informational
   mileage-estimate override for when an address geocodes wrong). VIEW = everyone (autocomplete + the list);
   ADD/EDIT/DELETE = owner/admin only (jobCanEditPlan), enforced in openPlace/savePlace/delPlaceRec so a hidden
   affordance is genuinely unreachable, not just visually hidden. */
const PLACE_CATS = ["vendor", "disposal", "supplier", "other"];
function placeCatLabel(c) { return ({ vendor: "Vendor", disposal: "Disposal", supplier: "Supplier", other: "Other" })[c] || "Other"; }
/* active (non-deleted) places */
function actPlaces() { return ((typeof D === "function" && D() && D().places) || []).filter(p => p && !p.deleted); }
/* geocode a place's address → lat/lng (same free OSM Nominatim path as geocodeProp/hbGeocode). Best-effort. */
function geocodePlace(p) { if (!p || !p.address || typeof fetch !== "function") return; fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(p.address)).then(r => r.json()).then(d => { if (d && d[0]) { p.lat = +d[0].lat; p.lng = +d[0].lon; if (typeof touch === "function") touch(p); if (typeof save === "function") save(); if (typeof render === "function") render(); } }).catch(function () { }); }

let PLSEARCH = "", PLSHOWN = 150;
/* PURE results-list HTML (search runs on the FULL list; slice ONLY the display array — Load-more cap mirrors
   js/06 properties). Byte-identical to no-cap while list.length<=PLSHOWN. */
function placesListHTML() {
  const canEdit = (typeof jobCanEditPlan === "function") ? jobCanEditPlan() : false;
  let list = actPlaces().slice().sort((a, b) => (a.name || a.address || "").localeCompare(b.name || b.address || ""));
  if (PLSEARCH) { const q = PLSEARCH.toLowerCase(); list = list.filter(p => ((p.name || "") + (p.address || "")).toLowerCase().includes(q)); }
  if (!actPlaces().length) return `<div class="empty"><div class="big">📍</div>No saved places yet.${canEdit ? "<br>Add vendors, the transfer station, suppliers — they'll autocomplete in every address field." : ""}</div>`;
  if (!list.length) return `<div class="empty">No matches.</div>`;
  const more = list.length > PLSHOWN ? `<button class="btn ghost" onclick="plLoadMore()">Load more (${Math.min(150, list.length - PLSHOWN)} of ${list.length - PLSHOWN} left)</button>` : "";
  return `<div class="card grid2">` + list.slice(0, PLSHOWN).map(p => liPlace(p, canEdit)).join("") + `</div>` + more;
}
window.plLoadMore = function () { PLSHOWN += 150; const c = document.getElementById("pllist"); if (c) c.innerHTML = placesListHTML(); };
window.plSearchOn = function (v) { PLSHOWN = 150; PLSEARCH = v; const c = document.getElementById("pllist"); if (c) c.innerHTML = placesListHTML(); };
function liPlace(p, canEdit) {
  const addr = p.address || "";
  const chip = `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--soft);color:var(--muted);vertical-align:middle">${esc(placeCatLabel(p.category))}</span>`;
  const mm = (typeof p.manualMiles === "number" && p.manualMiles > 0) ? ` <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--accent-soft);color:var(--accent-ink);vertical-align:middle">🚗 ${p.manualMiles} mi one-way</span>` : "";
  const addrHtml = addr ? `<a href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--brand-text);text-decoration:underline">${esc(addr)}</a>` : "no address";
  const _drive = (p.lat != null && typeof driveBadge === "function") ? driveBadge(p.lat, p.lng) : "";
  const click = canEdit ? ` onclick="openPlace('${p.id}')"` : "";
  return `<div class="li"${click}><div class="grow"><div class="nm">${esc(p.name || p.address || "Place")} ${chip}${mm}</div><div class="sub" style="white-space:normal">${addrHtml}${_drive ? " · " + _drive : ""}</div></div></div>`;
}
function rPlaces() {
  const canEdit = (typeof jobCanEditPlan === "function") ? jobCanEditPlan() : false;
  let h = (typeof acctSubnav === "function" ? acctSubnav() : "");
  h += `<input class="search" id="plsearch" placeholder="Search places…" value="${esc(PLSEARCH)}" oninput="plSearchOn(this.value)">`;
  if (canEdit) h += `<button class="btn acc" style="width:100%;margin-bottom:8px" onclick="openPlace('')">+ Add place</button>`;
  h += `<div class="sub" style="white-space:normal;margin:0 4px 8px">Saved non-customer locations — the transfer station, vendors, suppliers. They autocomplete in every address field${canEdit ? ", and a manual one-way mileage keeps the route estimate honest when an address geocodes wrong" : ""}.</div>`;
  h += `<div id="pllist">${placesListHTML()}</div>`;
  view.innerHTML = h;
}
/* EDIT PAGE (modal) — owner/admin only. Modeled on openProperty/saveProperty. */
window.openPlace = function (id) {
  if (typeof jobCanEditPlan === "function" && !jobCanEditPlan()) { if (typeof alert === "function") alert("Owner/admin only."); return; }
  const d = D(); if (!Array.isArray(d.places)) d.places = [];
  const isNew = !id;
  const p = id ? d.places.find(x => x && x.id === id) : { id: (typeof uid === "function" ? uid() : String(Math.random())), name: "", address: "", category: "vendor", manualMiles: null, lat: null, lng: null, type: "saved" };
  if (!p) return;
  modal(isNew ? "New place" : "Place", `
    <label style="margin-top:0">Name</label><input id="pl_name" value="${esc(p.name || "")}" placeholder="e.g. Dare County Transfer Station, Lowe's — Kitty Hawk">
    <label>Address</label><div class="acwrap"><input id="pl_addr" value="${esc(p.address || "")}" placeholder="Start typing the address…" oninput="addrSuggest('pl_addr','pl_box')" autocomplete="off"><div class="acbox" id="pl_box"></div></div>
    <button class="btn ghost sm" style="margin-top:6px" onclick="placeGeocodeNow('${p.id}')">📍 Locate on the map</button>
    <div id="pl_geo" class="sub" style="margin-top:4px">${p.lat != null ? '<span style="color:var(--accent)">📍 Located.</span>' : '<span class="muted">Not located yet.</span>'}</div>
    <label>Category</label><select id="pl_cat">${PLACE_CATS.map(c => `<option value="${c}" ${(p.category || "vendor") === c ? "selected" : ""}>${placeCatLabel(c)}</option>`).join("")}</select>
    <label>One-way miles from home base <span class="sub">· optional — use if the address geocodes wrong</span></label>
    <input id="pl_miles" type="number" inputmode="decimal" step="0.1" min="0" value="${(typeof p.manualMiles === "number" && p.manualMiles > 0) ? p.manualMiles : ""}" placeholder="e.g. 12.5">
    <div class="sub" style="white-space:normal;margin-top:4px">Feeds the route-mileage <b>estimate</b> only (a base↔this-place leg uses this instead of the straight-line guess). Never touches the billed odometer or reimbursement.</div>
    <button class="btn acc" style="margin-top:14px;width:100%" onclick="savePlace('${p.id}',${isNew})">Save place</button>
    ${!isNew ? `<button class="btn danger" style="margin-top:10px;width:100%" onclick="delPlaceRec('${p.id}')">Delete place</button>` : ""}
  `);
  if (typeof lockGuard === "function") lockGuard("place", isNew ? null : p.id, () => openPlace(id));
};
/* geocode-on-demand from the edit page (the address input's coords are reused automatically on save if the user
   PICKED a suggestion; this button forces a fresh lookup of the typed text). */
window.placeGeocodeNow = function (id) {
  if (typeof jobCanEditPlan === "function" && !jobCanEditPlan()) return;
  const p = (D().places || []).find(x => x && x.id === id); const addr = (val("pl_addr") || "").trim();
  const el = document.getElementById("pl_geo"); if (el) el.innerHTML = '<span class="muted">Locating…</span>';
  if (!addr) { if (el) el.innerHTML = '<span style="color:var(--danger)">Enter an address first.</span>'; return; }
  fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr)).then(r => r.json()).then(d => {
    if (d && d[0] && p) { p.lat = +d[0].lat; p.lng = +d[0].lon; if (typeof touch === "function") touch(p); if (typeof save === "function") save(); if (el) el.innerHTML = '<span style="color:var(--accent)">📍 Located — if it\'s wrong, set the one-way miles below.</span>'; }
    else if (el) el.innerHTML = '<span style="color:var(--danger)">Couldn\'t locate that — set the one-way miles below instead.</span>';
  }).catch(function () { if (el) el.innerHTML = '<span style="color:var(--danger)">Lookup failed — set the one-way miles below instead.</span>'; });
};
window.savePlace = function (id, isNew) {
  if (typeof jobCanEditPlan === "function" && !jobCanEditPlan()) { if (typeof alert === "function") alert("Owner/admin only."); return; }
  const d = D(); if (!Array.isArray(d.places)) d.places = [];
  let p = isNew ? { id: id, name: "", type: "saved", lat: null, lng: null } : d.places.find(x => x && x.id === id);
  if (!p) return;
  const name = (val("pl_name") || "").trim(), addr = (val("pl_addr") || "").trim();
  if (!name && !addr) { if (typeof alert === "function") alert("Add a name or address."); return; }
  if (typeof submitGuard === "function" && !submitGuard("savePlace:" + id)) return;   // rapid-tap dupe guard
  p.name = name; p.address = addr;
  const cat = val("pl_cat"); p.category = PLACE_CATS.indexOf(cat) >= 0 ? cat : "other";
  const mm = parseFloat(val("pl_miles")); p.manualMiles = (mm > 0) ? mm : null;
  // saved-location pre-read (js/69 pattern): if the address was PICKED from a suggestion, reuse its exact coords +
  // SKIP re-geocoding; else best-effort geocode the typed text in the background.
  const _pi = (typeof document !== "undefined") ? document.getElementById("pl_addr") : null;
  let reuse = false;
  if (_pi && _pi.dataset && _pi.dataset.pickLat) { p.lat = +_pi.dataset.pickLat; p.lng = +_pi.dataset.pickLng; reuse = true; delete _pi.dataset.pickLat; delete _pi.dataset.pickLng; delete _pi.dataset.pickPlaceId; delete _pi.dataset.pickPropId; delete _pi.dataset.pickManualMiles; }
  if (typeof touch === "function") touch(p);
  if (isNew) d.places.push(p);
  if (typeof logChange === "function") logChange(isNew ? "create" : "update", "place", p.id, (isNew ? "Added place " : "Updated place ") + (p.name || p.address || ""));
  if (!reuse && p.lat == null && addr) geocodePlace(p);   // only auto-geocode when we don't already have coords
  if (typeof save === "function") save();
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
/* soft-delete — reuse js/19's delPlace (sets deleted+updatedAt+save), then log + refresh this surface. */
window.delPlaceRec = function (id) {
  if (typeof jobCanEditPlan === "function" && !jobCanEditPlan()) { if (typeof alert === "function") alert("Owner/admin only."); return; }
  if (typeof confirm === "function" && !confirm("Delete this place?")) return;
  const p = (D().places || []).find(x => x && x.id === id); if (!p) return;
  if (typeof delPlace === "function") delPlace(id); else { p.deleted = true; if (typeof touch === "function") touch(p); if (typeof save === "function") save(); }
  if (typeof logChange === "function") logChange("delete", "place", id, "Deleted place " + (p.name || p.address || ""));
  if (typeof closeModal === "function") closeModal();
  if (typeof render === "function") render();
};
