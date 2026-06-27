/* ---------- ESCAPE-ROOM BOOKING (FRAMEWORK ONLY) ----------
   Stubbed booking page for an escape-room org. This is SCAFFOLDING only — it lays out the
   INTENDED flow (pick a DATE → list of GAMES with available/booked status + a PRICE that scales
   with PARTY SIZE → a PAYMENT step) as non-functional labels so it's obvious where real logic goes.
   NO real availability, NO payment integration, NO synced data. Org-gated via the 'bookings'
   template (js/03 ORG_TEMPLATES) so it never shows for OBX / Jamieson. Flesh out later. */

// Placeholder catalog — illustrative only, not wired to inventory or any synced collection.
const EB_GAMES = [
  { id:"vault",   name:"The Vault",        minutes:60, status:"available", basePrice:35 },
  { id:"cabin",   name:"Cabin in the Woods", minutes:60, status:"booked",    basePrice:35 },
  { id:"heist",   name:"Midnight Heist",   minutes:75, status:"available", basePrice:40 }
];
let EB_PARTY = 4;   // placeholder party size used only to demo the per-person price label

// Placeholder pricing: per-person base. Real model (tiers, minimums, peak rates) comes later.
function ebPriceFor(game, party){ return (game.basePrice||0) * Math.max(1, party|0); }

function rBooking(){
  let h = `<div class="secthd"><h2>🎟️ Booking</h2></div>`;

  // Loud "not functional yet" banner so nobody mistakes this for a live booking tool.
  h += `<div class="card" style="background:var(--soft);border:1px dashed var(--brand-text)">
    <div class="nm" style="white-space:normal">Framework — not yet functional</div>
    <div class="sub" style="white-space:normal">This page is a scaffold showing the intended booking flow. Dates, availability, pricing, and payment are placeholders — nothing here saves, charges, or syncs yet.</div>
  </div>`;

  // STEP 1 — DATE
  h += `<div class="card">
    <div class="nm">1 · Pick a date</div>
    <div class="sub" style="white-space:normal">Customer chooses the day. Later this drives which game slots show as available.</div>
    <input type="date" id="eb_date" style="margin-top:8px" onchange="ebPickDate(this.value)" disabled>
    <div class="sub" style="opacity:.6;margin-top:6px">Disabled — wiring to a real calendar/availability source is TODO.</div>
  </div>`;

  // STEP 2 — GAMES (available vs booked) + price that scales with party size
  h += `<div class="card">
    <div class="nm">2 · Choose a game</div>
    <div class="sub" style="white-space:normal">Each game shows availability for the chosen date and a price that scales with party size.</div>
    <label style="margin-top:8px;display:block">Party size (demo only)</label>
    <input type="number" id="eb_party" min="1" max="12" value="${EB_PARTY}" oninput="ebSetParty(this.value)" style="max-width:120px">
    <div style="margin-top:10px">` +
    EB_GAMES.map(g=>{
      const booked = g.status==="booked";
      const pill = booked
        ? `<span class="pill" style="background:var(--danger);color:#fff">Booked</span>`
        : `<span class="pill" style="background:var(--ok,#2e7d32);color:#fff">Available</span>`;
      return `<div class="li" style="${booked?"opacity:.55":""}">
        <div class="grow">
          <div class="nm" style="white-space:normal">${esc(g.name)} ${pill}</div>
          <div class="sub" style="white-space:normal">${g.minutes} min · placeholder price <b>$${ebPriceFor(g, EB_PARTY)}</b> for ${EB_PARTY} (= $${g.basePrice}/person)</div>
        </div>
        <button class="btn acc sm" disabled>${booked?"Unavailable":"Select"}</button>
      </div>`;
    }).join("") +
    `</div>
    <div class="sub" style="opacity:.6;margin-top:6px">Availability + per-person pricing shown here are hard-coded placeholders.</div>
  </div>`;

  // STEP 3 — PAYMENT
  h += `<div class="card">
    <div class="nm">3 · Payment</div>
    <div class="sub" style="white-space:normal">Collect a deposit or full payment to confirm the slot. No payment processor is connected — this is where checkout (e.g. Stripe) plugs in later.</div>
    <button class="btn acc" style="margin-top:10px;width:100%" disabled>Pay &amp; confirm (disabled)</button>
  </div>`;

  view.innerHTML = h;
}

// Stubs so the disabled controls have a home when they're enabled later. No-ops for now.
window.ebPickDate = function(v){ /* TODO: load availability for v */ };
window.ebSetParty = function(v){ EB_PARTY = Math.max(1, parseInt(v,10)||1); rBooking(); };
