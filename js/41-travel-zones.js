/* ---------- SHARED TRAVEL / ZONE PRICING (js/41) ----------
   One helper so a trip charge is never left off a quote. Given a job ZONE (or an
   explicit round-trip mileage), it returns a billable travel charge:
       round-trip miles × per-mile rate  +  remote-zone surcharge,  floored at a zone minimum.
   It is auto-wired as a line into the junk (js/21), shed-demo (js/30), and brush (js/42)
   estimators so travel can't be forgotten. The LINE'S COST is the real mileage cost
   (mileageCost, the IRS-rate vehicle cost); the charge is the customer-facing revenue.

   This is plumbing, not a page — there is no nav entry, just the script tag in the shell.

   RAY: confirm — every number in TRAVEL_ZONES_DEFAULT below is a pricing default you can
   change. The per-mile rate reuses the cost-model mileage rate (IRS 2026, 72.5¢/mi); the
   surcharges and minimums are travel-pricing knobs, not hard costs. */

var TRAVEL_RATE_PER_MI = (typeof MILEAGE_RATE !== "undefined") ? MILEAGE_RATE : 0.725; // $/mi round-trip — tracks the IRS rate used everywhere else
var TRAVEL_ZONES_DEFAULT = {
  // key:     { label (shown), short (line name), surcharge $, zone minimum $, representative round-trip miles }
  local:   { label:"Local — Kitty Hawk / Kill Devil Hills / Nags Head", short:"Local",        surcharge:0,  min:100, miles:20 }, // RAY: confirm
  mid:     { label:"Mid — Manteo / Currituck mainland",                 short:"Mid",          surcharge:25, min:100, miles:45 }, // RAY: confirm
  remoteN: { label:"Remote-North — Corolla / Carova (4×4 beach)",       short:"Remote-North", surcharge:75, min:150, miles:80 }  // RAY: confirm
};
var TRAVEL_ZONE_ORDER = ["local", "mid", "remoteN"];

function travelZone(z){ return TRAVEL_ZONES_DEFAULT[z] || TRAVEL_ZONES_DEFAULT.local; }

/* travelCharge({zone, miles}) → priced travel breakdown.
   miles (round-trip) overrides the zone's representative distance when supplied. */
function travelCharge(opts){
  opts = opts || {};
  var zKey = TRAVEL_ZONES_DEFAULT[opts.zone] ? opts.zone : "local";
  var zone = TRAVEL_ZONES_DEFAULT[zKey];
  var miles = (opts.miles != null && opts.miles !== "") ? Math.max(0, +opts.miles || 0) : zone.miles;
  var mileagePart = Math.round(miles * TRAVEL_RATE_PER_MI * 100) / 100;
  var raw = mileagePart + (zone.surcharge || 0);
  var hitMin = raw < (zone.min || 0);
  var charge = Math.round(Math.max(raw, zone.min || 0));
  return { zone:zKey, label:zone.label, short:zone.short, miles:miles, rate:TRAVEL_RATE_PER_MI,
           mileage:mileagePart, surcharge:zone.surcharge || 0, min:zone.min || 0, charge:charge, hitMin:hitMin };
}

/* The billable quote line. Cost = the real mileage cost; price = the travel charge. */
function travelLineItem(opts){
  var t = travelCharge(opts);
  var bits = t.miles + " mi round-trip × " + MILEAGE_RATE_LABEL;
  if (t.surcharge) bits += " + " + money(t.surcharge) + " " + t.short + " surcharge";
  if (t.hitMin) bits += " — held to the " + money(t.min) + " zone minimum";
  return { serviceId:"", name:"Travel / trip charge — " + t.short, unit:"job", qty:1,
           price:t.charge, cost:mileageCost(t.miles), notes:[bits], travel:true };
}

/* Zone <select>. onchangeJs is the handler body, e.g. "wizTravelZone(this.value)". */
function travelZoneSelect(selected, onchangeJs){
  return '<select onchange="' + onchangeJs + '" style="font-size:13px">' + TRAVEL_ZONE_ORDER.map(function(z){
    var zn = TRAVEL_ZONES_DEFAULT[z];
    return '<option value="' + z + '" ' + (selected === z ? "selected" : "") + '>' + esc(zn.label) + '</option>';
  }).join("") + '</select>';
}

/* Upsert a single travel line into a wizard items array (never duplicates it). */
function upsertTravelLine(items, opts){
  if (!items) return null;
  var line = travelLineItem(opts);
  var i = items.findIndex(function(x){ return x && x.travel; });
  if (i >= 0) items[i] = Object.assign({}, items[i], line); else items.push(line);
  return line;
}

/* ---- shared wizard travel card (used by the junk + brush estimators) ----
   Reads WZ.zone (default "local") and WZ.travelMiles (default = the zone's miles). */
function travelKeepRender(){
  var y = (document.scrollingElement || document.documentElement).scrollTop;
  render();
  (document.scrollingElement || document.documentElement).scrollTop = y;
}
window.wizTravelZone = function(z){
  if (typeof WZ === "undefined" || !WZ) return;
  WZ.zone = TRAVEL_ZONES_DEFAULT[z] ? z : "local";
  WZ.travelMiles = TRAVEL_ZONES_DEFAULT[WZ.zone].miles; // reset to the new zone's default round-trip
  travelKeepRender();
};
window.wizTravelMiles = function(v){
  if (typeof WZ === "undefined" || !WZ) return;
  WZ.travelMiles = Math.max(0, parseFloat(v) || 0);
  travelKeepRender();
};
/* Current {zone, miles} from wizard state, with sensible fallbacks. */
function wizTravelOpts(){
  var zone = (typeof WZ !== "undefined" && WZ && WZ.zone) ? WZ.zone : "local";
  var miles = (typeof WZ !== "undefined" && WZ && WZ.travelMiles != null) ? WZ.travelMiles : travelZone(zone).miles;
  return { zone:zone, miles:miles };
}
function travelCardHTML(){
  var o = wizTravelOpts(), t = travelCharge(o);
  return '<div class="card"><div style="font-weight:800;margin-bottom:6px">🚚 Travel / trip charge '
    + '<span class="sub" style="font-weight:400">— auto-added so it\'s never forgotten</span></div>'
    + '<label style="margin-top:0">Job zone</label>' + travelZoneSelect(o.zone, "wizTravelZone(this.value)")
    + '<label>Round-trip miles</label><input type="number" inputmode="decimal" value="' + t.miles + '" onchange="wizTravelMiles(this.value)">'
    + '<div class="sub" style="margin-top:6px">' + t.miles + ' mi × ' + MILEAGE_RATE_LABEL
    + (t.surcharge ? ' + ' + money(t.surcharge) + ' ' + esc(t.short) + ' surcharge' : '')
    + (t.hitMin ? ' → held to the ' + money(t.min) + ' zone minimum' : '')
    + ' = <b>' + money(t.charge) + '</b> travel charge (cost ' + money(mileageCost(t.miles)) + ').</div></div>';
}
