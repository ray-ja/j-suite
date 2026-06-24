/* ---------- CALL LEAD (Sales subtab) ----------
   Someone calls wanting a quote. You're an engineer, not a salesperson — so the app runs the call.
   Lives as the "📞 Call Lead" tab under Sales (alongside Customers + Properties). Top-to-bottom: the
   exact words to say (psychologically-ordered) + fields that capture what you learn, the REAL schedule
   calendar (so you can offer a day), and quote-now category picks for simple jobs. Saving creates the
   customer + property, then quotes / books a visit / saves a lead. GC holds the in-progress call. */
let GC = {};
function gcInit(){ if (!GC._init) { const me = (typeof curUser === "function") ? curUser() : null; GC = { soldBy: me ? me.id : "", _init: true }; } }
window.openGuidedCall = function () { if (typeof ACCTSUB !== "undefined") ACCTSUB = "calllead"; TAB = "accounts"; render(); };   // legacy entry → the Call Lead tab
window.gcReset = function () { const me = (typeof curUser === "function") ? curUser() : null; GC = { soldBy: me ? me.id : "", _init: true }; if (typeof render === "function") render(); };

function gcStep(n, title, say, fields) {
  return `<div class="card"><div style="font-weight:800;margin-bottom:4px"><span style="color:var(--accent)">${n}</span> · ${esc(title)}</div><div class="note" style="white-space:normal${fields ? ";margin-bottom:8px" : ""}">🗣️ ${esc(say)}</div>${fields || ""}</div>`;
}
function gcQuotePick() {
  const list = (typeof WZ_SVC !== "undefined" && WZ_SVC[S.biz]) ? WZ_SVC[S.biz].filter(s => s[0] !== "parking") : [];
  if (!list.length) return "";
  return `<div class="card" style="border-left:4px solid var(--accent)"><div style="font-weight:800;margin-bottom:4px">📞 Quote it right now? (simple, known jobs)</div><div class="sub" style="white-space:normal;margin-bottom:8px">e.g. junk — "a fridge, a couch, a chair, 2nd floor." Pick the service → it saves them + drops you into pricing. Bigger / unseen jobs: book the visit below instead.</div><div class="grid2">` + list.map(s => `<button class="btn ghost" style="text-align:left;margin-bottom:8px" onclick="gcQuoteWith('${s[0]}')">${esc(s[1])}</button>`).join("") + `</div></div>`;
}

/* the Call Lead tab body (rendered inside the accounts view, under the subnav) */
function gcBody() {
  const me = (typeof curUser === "function") ? curUser() : null;
  let h = `<div class="row" style="margin:0 2px 8px;align-items:center"><div class="grow"><div class="nm" style="font-size:17px">📞 On a call — I've got you</div></div><button class="btn ghost sm" onclick="gcReset()">🔄 New call</button></div>`;
  h += gcStep("1", "Open warm + get their name", `"Thanks for calling OBX Lot Solutions — this is ${me ? me.username : "[you]"}. Who do I have the pleasure of speaking with?"  → then use their name the rest of the call.`, `<input id="gc_name" placeholder="Their name" value="${esc(GC.name || "")}" oninput="GC.name=this.value" autocomplete="off">`);
  h += gcStep("2", "Let them talk — what do they need?", `"Great to meet you, [name]. So tell me what's going on — what are you looking to get done?"  → Then LISTEN. Don't interrupt, don't jump to price. People buy when they feel heard.`, `<textarea id="gc_need" placeholder="What they need + key details" oninput="GC.need=this.value">${esc(GC.need || "")}</textarea>`);
  h += gcStep("3", "Where & when", `"Got it. What's the property address? … And when were you hoping to have it done?"  → The address lets you price + map it; urgency means you can hold your price.`, `<input id="gc_addr" placeholder="Property address" value="${esc(GC.address || "")}" oninput="GC.address=this.value" autocomplete="off"><input id="gc_when" placeholder="Timeline / urgency (ASAP, this month…)" value="${esc(GC.timeline || "")}" oninput="GC.timeline=this.value" autocomplete="off" style="margin-top:6px">`);
  h += gcStep("4", "Build trust (10 seconds)", `"We're local, we show up when we say we will, and the quote's free. We do a lot of this out here on the Outer Banks."  → You're the reliable local pro — that's your edge. Don't undersell it.`, "");
  h += gcStep("5", "Lock their contact", `"Let me grab your info so I can follow up and get you the quote — and what's the best way to reach you?"  → Confirm the number, get the email, and ask how they like to be contacted (some hate calls, some hate texts).`, `<input id="gc_phone" placeholder="Phone" inputmode="tel" value="${esc(GC.phone || "")}" oninput="GC.phone=this.value" autocomplete="off"><input id="gc_email" placeholder="Email" inputmode="email" value="${esc(GC.email || "")}" oninput="GC.email=this.value" autocomplete="off" style="margin-top:6px"><input id="gc_company" placeholder="Company / property mgmt (if any)" value="${esc(GC.company || "")}" oninput="GC.company=this.value" autocomplete="off" style="margin-top:6px"><label style="margin-top:6px">Preferred contact</label><select id="gc_comm" onchange="GC.commPref=this.value">${["", "Call", "Text", "Email", "No preference"].map(o => `<option value="${o}" ${GC.commPref === o ? "selected" : ""}>${o || "— how do they like to be reached? —"}</option>`).join("")}</select>`);
  h += gcStep("6", "CLOSE — set the next step (never skip this)", `"I'd love to swing by and give you an honest free quote — does [day] or [day] work better?"  → Always leave the call with a concrete next step. "I'll call you back" kills the sale. Use the calendar below to offer a real open day.`, "");
  if (typeof CALY !== "undefined" && CALY == null) { const _cd = new Date(); CALY = _cd.getFullYear(); CALM = _cd.getMonth(); }
  h += `<div style="font-weight:800;margin:10px 2px 6px">📅 The calendar — offer them an open day</div>`;
  h += (typeof renderCalendar === "function") ? renderCalendar((typeof actJ === "function") ? actJ().slice().sort((a, b) => (a.date + (a.time || "")) < (b.date + (b.time || "")) ? -1 : 1) : []) : `<div class="card"><div class="muted">Calendar unavailable.</div></div>`;
  h += gcQuotePick();
  h += `<div class="card" style="border-left:4px solid var(--accent)"><div style="font-weight:800;margin-bottom:6px">Couldn't quote on the phone? Save the call:</div>
    <button class="btn acc" style="width:100%;margin-bottom:8px" onclick="gcFinish('visit')">📅 Save + book an on-site quote visit</button>
    <button class="btn ghost" style="width:100%" onclick="gcFinish('lead')">📇 Save as a lead to follow up</button></div>`;
  return h;
}
function rCallLead() {
  gcInit();
  const _a = document.activeElement, _aid = _a && _a.id, _s = _a ? _a.selectionStart : 0, _e = _a ? _a.selectionEnd : 0;
  view.innerHTML = ((typeof acctSubnav === "function") ? acctSubnav() : "") + gcBody();
  if (_aid) { const el = document.getElementById(_aid); if (el) { el.focus(); try { el.setSelectionRange(_s, _e); } catch (ex) {} } }
}

/* save the customer (+ property) captured on the call; returns {c, prop} */
function gcSaveCustomer(status) {
  const d = D(), me = (typeof curUser === "function") ? curUser() : null;
  const c = { id: uid(), name: GC.name || "New lead", company: GC.company || "", phone: GC.phone || "", email: GC.email || "", commPref: GC.commPref || "", town: "", type: "Residential", status: status, source: "Phone call", soldBy: me ? me.id : "", manager: "", notes: [], next: "" };
  if (GC.need) c.notes.push({ t: new Date().toLocaleString(), text: "📞 Call: " + GC.need + (GC.timeline ? " · when: " + GC.timeline : "") + (GC.commPref ? " · prefers " + GC.commPref : "") });
  if (status === "Lead") { const t = new Date(Date.now() + 2 * 86400000); c.next = t.toISOString().slice(0, 10); }
  if (typeof touch === "function") touch(c); if (!d.customers) d.customers = []; d.customers.push(c);
  let prop = null;
  if (GC.address) { prop = { id: uid(), label: "Main", address: GC.address, accessNotes: "", lat: null, lng: null, customerIds: [c.id], updatedAt: now() }; if (!d.properties) d.properties = []; d.properties.push(prop); if (typeof geocodeProp === "function") geocodeProp(prop); }
  save();
  return { c: c, prop: prop };
}
function gcWizFor(c, prop) {
  const me = (typeof curUser === "function") ? curUser() : null;
  return { step: "pick", cust: { id: c.id, name: c.name, phone: GC.phone || "", address: GC.address || "", source: "Phone call", notes: "", propertyId: prop ? prop.id : "", soldBy: me ? me.id : "" }, items: [], recurring: false, disc: 0, discPct: null, miles: 0, hours: 0, crewN: 1, disposalTrip: false, haul: "pickup", zone: "local", travelMiles: null, svc: null, inp: {}, deep: {}, deepMods: {}, deepSearch: "", id: null, invoiced: false, paid: false, paymentLink: "", finalPrice: 0, adjNote: "" };
}
window.gcQuoteWith = function (svcKey) {
  if (!(GC.name || GC.phone)) { if (!confirm("No name or phone captured yet — save & quote anyway?")) return; }
  if (typeof WZON === "undefined") { alert("Quote builder unavailable."); return; }
  const r = gcSaveCustomer("Quoted");
  WZ = gcWizFor(r.c, r.prop); WZON = true; TAB = "quotes"; gcReset(); GC = { _init: true };
  render();
  if (svcKey && typeof wizSetSvc === "function") wizSetSvc(svcKey);
};
window.gcFinish = function (outcome) {
  if (!(GC.name || GC.phone)) { if (!confirm("No name or phone captured yet — save anyway?")) return; }
  const r = gcSaveCustomer(outcome === "lead" ? "Lead" : "Quoted"), name = r.c.name;
  const me = (typeof curUser === "function") ? curUser() : null;
  if (outcome === "quote" && typeof WZON !== "undefined") { WZ = gcWizFor(r.c, r.prop); GC = { soldBy: me ? me.id : "", _init: true }; WZON = true; TAB = "quotes"; render(); return; }
  GC = { soldBy: me ? me.id : "", _init: true };
  if (outcome === "visit") { TAB = "schedule"; if (typeof render === "function") render(); alert("Saved " + name + ". Now book the on-site quote visit on the calendar."); }
  else { if (typeof ACCTSUB !== "undefined") ACCTSUB = "customers"; TAB = "accounts"; if (typeof render === "function") render(); alert("Saved " + name + " as a lead — follow-up set for 2 days out."); }
};
