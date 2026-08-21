/* ---------- BILLABLE RATES (js/136) — a rate card you can actually change ------------------------------
   Ray, 2026-08-21: "Jamieson Automation is not always $125 an hour. In fact, all the escape room work is
   locked in at $55 per hour. So that needs to be a variable rate. It needs to show in the timesheets. But
   also there's emergency rates, there's overtime, there's holiday stuff. So it needs to be malleable."

   TWO KINDS OF RECORD, which between them express everything he listed and everything he hasn't thought of
   yet. This is the whole design:

     BASE  (kind:"base")  — a dollars-per-hour figure. With no customerId it is the org's standard rate;
                            with one it is that customer's CONTRACT rate. Escape room at $55 is just a base
                            with their customerId on it.
     MOD   (kind:"mod")   — a modifier applied to whichever base won. Normally a multiplier (Emergency 1.5×,
                            Holiday 2×), or a flat override when `flat` is set (a $200 call-out fee that
                            ignores the base entirely).

   ⭐ WHY A MULTIPLIER AND NOT A SECOND RATE: an emergency call at the escape room is $55 × 1.5 = $82.50,
   automatically. He never has to create "escape room emergency", "Twiddy emergency", "escape room holiday"
   and so on — N customers × M situations collapses to N + M records. Adding "Weekend ×1.25" makes it apply
   to every customer at once, which is what "malleable" has to mean to be worth anything.

   ⚠️ THE RESOLVED RATE IS STORED ON THE SHIFT, NOT LOOKED UP LATER. If he raises the standard rate next
   spring, last autumn's timesheets must still read what was actually agreed and billed. A rate card is a
   set of defaults for NEW work — it is not a retroactive price list. Shifts carry billRate / billBase /
   billMult / billRateName so a punch is self-describing forever, even if the rate that produced it is later
   edited or deleted.

   Record: { id:"br_…", kind:"base"|"mod", name, value, customerId:"", flat:false, isDefault:false,
             order:0, deleted, updatedAt } */

if (typeof window === "undefined") { var window = {}; }   // node test shim

/* The starter modifiers. Deliberately NO base rate is seeded: inventing a dollar figure would be worse than
   having none, because a wrong number bills a real customer. With no base the resolver returns 0 and the UI
   says so plainly until he sets it. */
var BR_SEED = [
  { key: "std",  kind: "mod", name: "Standard",  value: 1,   isDefault: true,  order: 0 },
  { key: "ot",   kind: "mod", name: "Overtime",  value: 1.5, order: 1 },
  { key: "emer", kind: "mod", name: "Emergency", value: 1.5, order: 2 },
  { key: "hol",  kind: "mod", name: "Holiday",   value: 2,   order: 3 }
];

function actBillRates() { return (D().billRates || []).filter(function (r) { return r && !r.deleted; }); }
function brBases() { return actBillRates().filter(function (r) { return r.kind === "base"; }).sort(brOrder); }
function brMods() { return actBillRates().filter(function (r) { return r.kind === "mod"; }).sort(brOrder); }
function brOrder(a, b) { return (a.order || 0) - (b.order || 0) || String(a.name || "").localeCompare(String(b.name || "")); }
function brDefaultMod() { var m = brMods(); return m.find(function (r) { return r.isDefault; }) || m[0] || null; }

/* seed the modifiers once, on first look — never the base */
function brSeed() {
  try {
    var d = D(); if (!Array.isArray(d.billRates)) d.billRates = [];
    var have = {}; d.billRates.forEach(function (r) { if (r && r.key) have[r.key] = 1; });
    var added = 0;
    BR_SEED.forEach(function (s) {
      if (have[s.key]) return;
      var r = { id: "br_" + s.key, key: s.key, kind: s.kind, name: s.name, value: s.value,
                customerId: "", flat: false, isDefault: !!s.isDefault, order: s.order, deleted: false };
      if (typeof touch === "function") touch(r);
      d.billRates.push(r); added++;
    });
    if (added && typeof save === "function") save();
    return added;
  } catch (e) { return 0; }
}

/* ---------- THE RESOLVER — pure, so it is tested by being CALLED ----------
   bases/mods are passed in rather than read from D(), which keeps this honest under test and lets the
   timesheet re-resolve a historical shift from its own stored numbers instead of today's card. */
function brResolve(bases, mods, customerId, modId) {
  bases = bases || []; mods = mods || [];
  var base = null;
  if (customerId) base = bases.find(function (r) { return r && r.customerId === customerId; }) || null;
  if (!base) base = bases.find(function (r) { return r && !r.customerId; }) || null;
  var mod = null;
  if (modId) mod = mods.find(function (r) { return r && r.id === modId; }) || null;
  if (!mod) mod = mods.find(function (r) { return r && r.isDefault; }) || mods[0] || null;

  var baseVal = base ? Math.max(0, +base.value || 0) : 0;
  var rate, mult = 1;
  if (mod && mod.flat) { rate = Math.max(0, +mod.value || 0); mult = 0; }   // flat override ignores the base
  else { mult = mod ? Math.max(0, +mod.value || 0) : 1; rate = baseVal * mult; }

  return {
    rate: Math.round(rate * 100) / 100,
    base: baseVal, mult: mult,
    baseId: base ? base.id : "", baseName: base ? base.name : "",
    modId: mod ? mod.id : "", modName: mod ? mod.name : "",
    flat: !!(mod && mod.flat),
    contract: !!(base && base.customerId),        // a customer-specific rate won, not the org default
    missing: !base && !(mod && mod.flat)          // nothing to bill against — the UI must say so
  };
}

/* what a shift is worth, from the numbers STORED ON IT (never from today's card) */
function brShiftAmount(entry) {
  if (!entry || !entry.clockOut) return 0;
  var hrs = Math.max(0, (entry.clockOut - entry.clockIn) / 3600000);
  return Math.round(hrs * (+entry.billRate || 0) * 100) / 100;
}
/* the one-line rate label a timesheet shows */
function brShiftLabel(entry) {
  if (!entry || !(+entry.billRate)) return "";
  var s = "$" + (+entry.billRate).toFixed(2) + "/hr";
  if (entry.billRateName && entry.billRateName !== "Standard") s += " · " + entry.billRateName;
  if (entry.billMult && entry.billMult !== 1 && entry.billBase) s += " (" + entry.billBase + " × " + entry.billMult + ")";
  return s;
}

/* ---------- the picker shown on the clock-in form ---------- */
function brPickerHTML(customerId, selId) {
  if (typeof D !== "function") return "";
  brSeed();
  var mods = brMods(), bases = brBases();
  if (!mods.length) return "";
  var sel = selId || (brDefaultMod() || {}).id || "";
  var r = brResolve(bases, mods, customerId, sel);
  var money_ = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(2); };
  return '<label style="margin-top:10px">Rate</label>'
    + '<select id="tc_rate" onchange="brPicked()">'
    + mods.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === sel ? " selected" : "") + '>' + esc(m.name)
        + (m.flat ? " · " + money_(m.value) + "/hr flat" : (m.value !== 1 ? " · ×" + m.value : "")) + '</option>'; }).join("")
    + '</select>'
    + '<div class="sub" id="tc_rate_why" style="white-space:normal;margin-top:5px">' + esc(brWhy(r)) + '</div>';
}
function brWhy(r) {
  if (r.missing) return "⚠ No standard rate set yet — this shift will bill at $0. Set one under Rates on the Time tab.";
  var s = "$" + r.rate.toFixed(2) + "/hr";
  if (r.flat) return s + " — flat rate, ignores the standard rate.";
  if (r.contract) s += " — " + r.baseName + " (contract rate)";
  else s += " — standard rate";
  if (r.mult !== 1) s += ", ×" + r.mult + " for " + r.modName;
  return s + ".";
}

if (typeof window !== "undefined") {
  window.actBillRates = actBillRates; window.brBases = brBases; window.brMods = brMods;
  window.brResolve = brResolve; window.brShiftAmount = brShiftAmount; window.brShiftLabel = brShiftLabel;
  window.brPickerHTML = brPickerHTML; window.brSeed = brSeed; window.brDefaultMod = brDefaultMod;

  /* resolve for the CURRENT form state — used at clock-in to stamp the shift */
  window.brResolveNow = function (customerId, modId) { brSeed(); return brResolve(brBases(), brMods(), customerId, modId); };

  window.brPicked = function () {
    var el = document.getElementById("tc_rate_why"); if (!el) return;
    var cust = (typeof val === "function") ? (val("tc_cust") || "") : "";
    var jid = (typeof val === "function") ? (val("tc_job") || "") : "";
    if (jid && typeof tcJob === "function") { var j = tcJob(jid); if (j && j.customerId) cust = j.customerId; }
    el.textContent = brWhy(brResolveNow(cust, (typeof val === "function") ? val("tc_rate") : ""));
  };

  /* ---------- the editor ---------- */
  window.rBillRates = function () { if (typeof render === "function") render(); };
  window.brCardHTML = function () {
    brSeed();
    var bases = brBases(), mods = brMods();
    var money_ = (typeof money === "function") ? money : function (n) { return "$" + (+n || 0).toFixed(2); };
    var h = '<div class="secthd"><h2>💵 Billable rates</h2></div>';
    h += '<div class="card"><div style="font-weight:800;margin-bottom:2px">Standard &amp; contract rates</div>'
      + '<div class="sub" style="white-space:normal;margin-bottom:6px">The dollars-per-hour before any modifier. One with no customer is your standard rate; one with a customer is their contract rate.</div>';
    if (!bases.length) h += '<div class="sub" style="color:var(--danger);white-space:normal">⚠ No standard rate set — time bills at $0 until you add one.</div>';
    bases.forEach(function (r) {
      h += '<div class="li"><div class="grow"><div class="nm">' + esc(r.name || "Rate") + ' · ' + money_(r.value) + '/hr</div>'
        + '<div class="sub">' + (r.customerId ? esc((typeof custName === "function") ? custName(r.customerId) : "a customer") + " — contract" : "everyone — standard") + '</div></div>'
        + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="brEdit(\'' + r.id + '\')">✎</button></div>';
    });
    h += '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="brEdit(\'\',\'base\')">＋ Add a rate</button></div>';

    h += '<div class="card"><div style="font-weight:800;margin-bottom:2px">Situations</div>'
      + '<div class="sub" style="white-space:normal;margin-bottom:6px">Applied on top of whichever rate above is in play — so Emergency at the escape room is their $55 × 1.5, automatically. Add your own.</div>';
    mods.forEach(function (r) {
      h += '<div class="li"><div class="grow"><div class="nm">' + esc(r.name || "Rate") + (r.isDefault ? ' <span class="badge" style="background:var(--soft);color:var(--muted)">default</span>' : '') + '</div>'
        + '<div class="sub">' + (r.flat ? money_(r.value) + "/hr flat — ignores the standard rate" : "×" + r.value) + '</div></div>'
        + '<button class="btn ghost sm" style="flex:0 0 auto" onclick="brEdit(\'' + r.id + '\')">✎</button></div>';
    });
    h += '<button class="btn ghost sm" style="width:100%;margin-top:8px" onclick="brEdit(\'\',\'mod\')">＋ Add a situation</button></div>';
    h += '<div class="card"><div class="sub" style="white-space:normal">Changing a rate here only affects <b>new</b> shifts. Time already logged keeps the rate it was clocked at, so old timesheets never re-price themselves.</div></div>';
    return h;
  };

  window.brEdit = function (id, kind) {
    var r = id ? actBillRates().find(function (x) { return x.id === id; }) : null;
    var k = r ? r.kind : (kind || "mod");
    var custs = (typeof D === "function" ? (D().customers || []) : []).filter(function (c) { return c && !c.deleted; });
    var body = '<label style="margin-top:0">Name</label>'
      + '<input id="br_name" value="' + esc(r ? (r.name || "") : "") + '" placeholder="' + (k === "base" ? "e.g. Escape room contract" : "e.g. After hours") + '" autofocus>';
    if (k === "base") {
      body += '<label>Dollars per hour</label><input id="br_value" type="number" inputmode="decimal" value="' + (r ? r.value : "") + '" placeholder="125">'
        + '<label>Who does this apply to?</label><select id="br_cust"><option value="">Everyone — my standard rate</option>'
        + custs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (r && r.customerId === c.id ? " selected" : "") + '>'
            + esc((c.company ? c.company + (c.name ? " · " + c.name : "") : (c.name || "Customer"))) + '</option>'; }).join("") + '</select>';
    } else {
      body += '<label>How does it change the rate?</label>'
        + '<select id="br_flat"><option value="0"' + (r && r.flat ? "" : " selected") + '>Multiply the rate in play</option>'
        + '<option value="1"' + (r && r.flat ? " selected" : "") + '>Flat dollars per hour (ignores it)</option></select>'
        + '<label id="br_vlabel">' + (r && r.flat ? "Dollars per hour" : "Multiplier (1.5 = time and a half)") + '</label>'
        + '<input id="br_value" type="number" inputmode="decimal" step="0.05" value="' + (r ? r.value : "") + '" placeholder="1.5">'
        + '<label style="margin-top:10px"><input type="checkbox" id="br_def" style="width:auto;margin-right:6px"' + (r && r.isDefault ? " checked" : "") + '>Use this by default on new shifts</label>';
    }
    modal(r ? "Edit rate" : (k === "base" ? "New rate" : "New situation"), body
      + '<button class="btn acc" style="margin-top:12px;width:100%" onclick="brSave(\'' + (id || "") + '\',\'' + k + '\')">Save</button>'
      + (r ? '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="brDel(\'' + r.id + '\')">Delete</button>' : ''));
  };

  window.brSave = function (id, kind) {
    var name = (typeof val === "function" ? val("br_name") : "").trim();
    if (!name) { alert("Give it a name."); return; }
    var v = parseFloat((typeof val === "function") ? val("br_value") : "");
    if (!(v >= 0)) { alert("Enter a number."); return; }
    var d = D(); if (!Array.isArray(d.billRates)) d.billRates = [];
    var r = id ? d.billRates.find(function (x) { return x && x.id === id; }) : null;
    if (!r) {
      r = { id: "br_" + (typeof uid === "function" ? uid() : String(Date.now())), kind: kind, order: 50 };
      d.billRates.push(r);
    }
    r.name = name.slice(0, 60); r.value = v; r.deleted = false;
    if (kind === "base") { r.customerId = (typeof val === "function") ? (val("br_cust") || "") : ""; r.flat = false; r.isDefault = false; }
    else {
      r.customerId = "";
      r.flat = ((typeof val === "function") ? val("br_flat") : "0") === "1";
      var def = document.getElementById("br_def");
      if (def && def.checked) { d.billRates.forEach(function (x) { if (x && x.kind === "mod" && x.id !== r.id) { x.isDefault = false; if (typeof touch === "function") touch(x); } }); r.isDefault = true; }
      else r.isDefault = false;
    }
    if (typeof touch === "function") touch(r);
    if (typeof save === "function") save();
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };

  window.brDel = function (id) {
    if (!confirm("Delete this rate? Shifts already clocked keep the rate they were logged at.")) return;
    var r = actBillRates().find(function (x) { return x.id === id; }); if (!r) return;
    r.deleted = true;
    if (typeof touch === "function") touch(r);
    if (typeof save === "function") save();
    if (typeof closeModal === "function") closeModal();
    if (typeof render === "function") render();
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { brResolve: brResolve, brShiftAmount: brShiftAmount, brShiftLabel: brShiftLabel, BR_SEED: BR_SEED };
}
