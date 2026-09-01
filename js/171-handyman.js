/* ---------- HANDYMAN — GENERIC LABOR-VALUE ESTIMATOR (js/171) ---------------------------------------
   Ray, 2026-09-01, pricing a 10-ft pool-equipment shelf after the fact: "this is like a custom handyman
   job. we can do some sort of handyman quote tool but like its gotta be generic — i dont do carpentry
   work unless i really have to."

   So: NO task catalog (a catalog is what makes a tool trade-specific). The job is priced by TIME at a
   difficulty-banded labor VALUE; everything else follows the house model (js/101 / js/112 / js/134):
     - PRICE = labor value: crew-hours × a $/crew-hour band — Light $95 · Standard $110 · Heavy $130
       (awkward, heavy lifting, ladders, crawl spaces). Band rate is editable per job.
     - MATERIALS are free-form pass-through lines at cost, each with a who-supplies toggle — these jobs
       routinely come with the customer already holding all the parts (both Christina jobs did).
     - Drive is the static charge ($45 default). $175 job minimum applied to labor+drive — materials
       never help meet the minimum (they're pass-through; they can't carry the job's value).
   Cost / Price / Profit / Margin with the 35% margin-floor warning, like every estimator. */

if (typeof window === "undefined") { var window = {}; }   // node test shim (browser: no-op)

const HM_DRIVE_DEF = 45;
const HM_MIN = 175;                                       // the job minimum (QE.MIN_JOB convention)
const HM_BANDS = [
  { key: "light",    label: "Light",    hint: "simple, ground level, no surprises",            rate: 95 },
  { key: "standard", label: "Standard", hint: "normal tools-out work",                         rate: 110 },
  { key: "heavy",    label: "Heavy",    hint: "heavy lifting, ladders, awkward or hot spaces", rate: 130 }
];

/* ---- THE CORE. Pure: config in, money out. No globals, no DOM — node-testable. ---- */
function hmCalc(hm) {
  hm = hm || {};
  const hours = Math.max(0, +hm.hours || 0);
  const crew = Math.max(1, +hm.crew || 2);
  const band = HM_BANDS.find(b => b.key === hm.band) || HM_BANDS[1];
  const rate = (hm.rate != null && hm.rate !== "") ? Math.max(0, +hm.rate) : band.rate;
  const drive = (hm.drive != null) ? Math.max(0, +hm.drive) : HM_DRIVE_DEF;

  const laborPrice = Math.round(hours * crew * rate * 100) / 100;

  /* materials: free-form pass-through lines */
  let matCost = 0;
  const matLines = [];
  (hm.mats || []).forEach(m => {
    if (!m || !(m.label || "").trim()) return;
    const qty = Math.max(0, +m.qty || 0) || 1;
    const each = Math.max(0, +m.cost || 0);
    const who = (m.who === "cust") ? "cust" : "us";
    const total = (who === "us") ? Math.round(qty * each * 100) / 100 : 0;
    matCost += total;
    matLines.push({ label: String(m.label).trim(), qty: qty, each: each, who: who, total: total });
  });
  matCost = Math.round(matCost * 100) / 100;

  /* the minimum bites on labor+drive only — pass-through materials can't carry a job to the floor */
  const base = Math.round((laborPrice + drive) * 100) / 100;
  const minApplied = base > 0 && base < HM_MIN;
  const charged = minApplied ? HM_MIN : base;

  const price = Math.round((charged + matCost) * 100) / 100;
  const cost = Math.round((matCost + drive) * 100) / 100;
  const profit = Math.round((price - cost) * 100) / 100;
  const margin = price > 0 ? Math.round((profit / price) * 1000) / 10 : 0;
  const perHr = (hours * crew) > 0 ? Math.round((profit / (hours * crew)) * 100) / 100 : 0;

  return { hours: hours, crew: crew, band: band.key, rate: rate, drive: drive,
           laborPrice: laborPrice, matLines: matLines, materials: matCost, matCost: matCost,
           minApplied: minApplied, price: price, cost: cost, profit: profit, margin: margin, perHr: perHr,
           lowMargin: price > 0 && margin < 35 };
}

/* the quote line this becomes */
function hmItem(c, hm) {
  const desc = String((hm && hm.desc) || "").trim();
  const notes = [];
  const custMats = c.matLines.filter(m => m.who === "cust");
  if (custMats.length) notes.push("Customer provides: " + custMats.map(m => m.label).join(", "));
  if (c.minApplied) notes.push("Priced at the $" + HM_MIN + " job minimum.");
  return {
    serviceId: "", name: "Handyman — " + (desc || "custom job"), unit: "job", price: c.price, qty: 1,
    cost: c.cost, estMat: c.materials,
    breakdown: ["~" + c.hours + "h × " + c.crew + " crew @ $" + c.rate + "/crew-hr (" + c.band + ")"],
    notes: notes, bandKey: "handyman", estHours: c.hours, estCrew: c.crew
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.hmCalc = hmCalc; window.hmItem = hmItem; window.HM_BANDS = HM_BANDS;

  window.wizHandymanStart = function () {
    if (typeof WZ === "undefined" || !WZ) return;
    WZ.svc = "handyman";
    if (!WZ.hm) WZ.hm = { desc: "", hours: 2, crew: 2, band: "standard", rate: null, drive: HM_DRIVE_DEF, mats: [] };
    if (typeof render === "function") render();
  };
  window.openHandymanEst = window.wizHandymanStart;

  window.wizHmField = function (k, v) { if (!WZ.hm) return; WZ.hm[k] = (k === "desc") ? String(v || "") : Math.max(0, parseFloat(v) || 0); if (typeof render === "function") render(); };
  window.wizHmBand = function (b) { if (!WZ.hm) return; WZ.hm.band = b; WZ.hm.rate = null; if (typeof render === "function") render(); };
  window.wizHmRate = function (v) { if (!WZ.hm) return; WZ.hm.rate = (v === "" ? null : Math.max(0, parseFloat(v) || 0)); if (typeof render === "function") render(); };
  window.wizHmCrew = function (n) { if (!WZ.hm) return; WZ.hm.crew = Math.max(1, n); if (typeof render === "function") render(); };
  window.wizHmMatAdd = function () { if (!WZ.hm) return; (WZ.hm.mats = WZ.hm.mats || []).push({ label: "", qty: 1, cost: 0, who: "cust" }); if (typeof render === "function") render(); };
  window.wizHmMatField = function (i, k, v) { const m = WZ.hm && WZ.hm.mats && WZ.hm.mats[i]; if (!m) return; m[k] = (k === "label") ? String(v || "") : Math.max(0, parseFloat(v) || 0); if (typeof render === "function") render(); };
  window.wizHmMatWho = function (i, who) { const m = WZ.hm && WZ.hm.mats && WZ.hm.mats[i]; if (!m) return; m.who = (who === "cust") ? "cust" : "us"; if (typeof render === "function") render(); };
  window.wizHmMatDel = function (i) { if (WZ.hm && WZ.hm.mats) WZ.hm.mats.splice(i, 1); if (typeof render === "function") render(); };

  window.wizHandymanUI = function () {
    if (!WZ.hm) window.wizHandymanStart();
    const hm = WZ.hm, c = hmCalc(hm);
    const money_ = (typeof money === "function") ? money : (n => "$" + (+n || 0).toFixed(2));

    /* keep the wizard's line in sync on every render — wizFinish() saves whatever is in WZ.items */
    WZ.items = [hmItem(c, hm)]; WZ.crewN = c.crew; WZ.hours = c.hours;
    if (typeof wizAutosave === "function") wizAutosave();

    let h = '<div class="card"><div style="font-weight:800;margin-bottom:2px">🔧 Handyman / custom job</div>'
      + '<div class="sub" style="white-space:normal">Generic by design: price the TIME, not the trade. Parts are pass-through at cost.</div></div>';

    h += '<div class="card"><label style="margin-top:0">What are we doing? (goes on the quote line)</label>'
      + '<input value="' + esc(hm.desc || "") + '" placeholder="e.g. build a 10 ft equipment shelf" onchange="wizHmField(\'desc\',this.value)">'
      + '<div class="row" style="gap:8px;margin-top:8px">'
      + '<div class="grow"><label style="margin-top:0">Hours on site</label><input type="number" inputmode="decimal" step="0.5" value="' + c.hours + '" onchange="wizHmField(\'hours\',this.value)"></div>'
      + '<div class="grow"><label style="margin-top:0">Crew</label><div class="row" style="gap:4px">'
      + [1, 2, 3].map(n => '<button class="btn ' + (c.crew === n ? "acc" : "ghost") + ' sm" onclick="wizHmCrew(' + n + ')">' + n + '</button>').join("") + '</div></div>'
      + '</div>'
      + '<label>Difficulty</label><div class="row" style="gap:4px;flex-wrap:wrap">'
      + HM_BANDS.map(b => '<button class="btn ' + (c.band === b.key ? "acc" : "ghost") + ' sm" title="' + esc(b.hint) + '" onclick="wizHmBand(\'' + b.key + '\')">' + esc(b.label) + ' $' + b.rate + '/hr</button>').join("")
      + '</div>'
      + '<div class="sub" style="margin-top:6px">$<input type="number" inputmode="decimal" value="' + c.rate + '" onchange="wizHmRate(this.value)" style="width:80px;display:inline-block;padding:4px 6px"> per crew-hour · ' + esc(HM_BANDS.find(b => b.key === c.band).hint) + '</div>'
      + '<label>Drive</label><input type="number" inputmode="decimal" value="' + c.drive + '" onchange="wizHmField(\'drive\',this.value)">'
      + '</div>';

    h += '<div class="card"><div style="font-weight:800;margin-bottom:2px">🔩 Parts — who provides each?</div>'
      + '<div class="sub" style="white-space:normal;margin-bottom:6px">Ours are pass-through at cost. Customer-provided lines cost the job nothing.</div>';
    (c.matLines.length ? c.matLines : []).forEach((m, i) => {
      h += '<div class="li" style="align-items:flex-start"><div class="grow">'
        + '<input value="' + esc(m.label) + '" placeholder="part / material" onchange="wizHmMatField(' + i + ',\'label\',this.value)" style="margin-bottom:4px">'
        + '<div class="sub"><input type="number" value="' + m.qty + '" onchange="wizHmMatField(' + i + ',\'qty\',this.value)" style="width:56px;display:inline-block;padding:4px 6px" inputmode="decimal"> × $'
        + '<input type="number" value="' + m.each + '" onchange="wizHmMatField(' + i + ',\'cost\',this.value)" style="width:74px;display:inline-block;padding:4px 6px" inputmode="decimal">'
        + (m.who === "us" ? ' = <b>' + esc(money_(m.total)) + '</b>' : ' <span class="sub">— customer\'s</span>') + '</div></div>'
        + '<div class="row" style="flex:0 0 auto;gap:4px">'
        + '<button class="btn ' + (m.who === "us" ? "acc" : "ghost") + ' sm" onclick="wizHmMatWho(' + i + ',\'us\')">We do</button>'
        + '<button class="btn ' + (m.who === "cust" ? "acc" : "ghost") + ' sm" onclick="wizHmMatWho(' + i + ',\'cust\')">They do</button>'
        + '<button class="btn ghost sm" onclick="wizHmMatDel(' + i + ')">✕</button>'
        + '</div></div>';
    });
    h += '<button class="btn ghost sm" style="margin-top:6px" onclick="wizHmMatAdd()">+ Add a part</button></div>';

    h += '<div class="card"><div style="font-size:13px;line-height:1.9">'
      + '🔨 Labor: ~' + c.hours + 'h × ' + c.crew + ' crew × $' + c.rate + ': <b>' + esc(money_(c.laborPrice)) + '</b><br>'
      + '🔩 Parts — pass-through at cost: <b>+' + esc(money_(c.materials)) + '</b><br>'
      + '🚗 Drive: <b>+' + esc(money_(c.drive)) + '</b>'
      + (c.minApplied ? '<br><span class="sub">Raised to the $' + HM_MIN + ' job minimum.</span>' : '') + '</div>'
      + '<div style="margin-top:8px;font-size:20px;font-weight:800;color:var(--brand-text)">' + esc(money_(c.price)) + '</div>'
      + '<div class="sub">cost ' + esc(money_(c.cost)) + ' · profit ' + esc(money_(c.profit)) + ' · margin ' + c.margin + '%'
      + (c.hours ? ' · ' + esc(money_(c.perHr)) + '/crew-hr profit' : '') + '</div>'
      + (c.lowMargin ? '<div class="sub" style="color:var(--danger);margin-top:6px;white-space:normal">⚠ Under the 35% margin floor.</div>' : '')
      + '</div>';

    h += '<div class="wizfoot"><div class="wf-amt"><span class="wf-lab">Quote</span><b>' + esc(money_(c.price)) + '</b></div>'
      + '<button class="btn ghost sm" onclick="WZ.step=\'pick\';render()">← Services</button>'
      + '<button class="btn acc grow" onclick="wizFinish()">Save &amp; present →</button></div>';
    return h;
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { hmCalc: hmCalc, hmItem: hmItem, HM_BANDS: HM_BANDS, HM_MIN: HM_MIN, HM_DRIVE_DEF: HM_DRIVE_DEF };
}
