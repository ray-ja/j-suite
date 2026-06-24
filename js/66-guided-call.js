/* ---------- LIVE CALL HELPER (Sales) ----------
   Someone calls wanting a quote. You're an engineer, not a salesperson — so the app runs the call.
   A single top-to-bottom page: the exact words to say (psychologically-ordered) + fields that capture
   what you learn, the next-2-weeks availability (so you can offer a day), and quote-now category picks
   for simple jobs. Ends by SAVING the customer + property, then quoting / booking a visit / saving a lead.
   Launched via openGuidedCall() (flag GCALL, checked in render() so sync re-renders keep it open). */
let GC = {};
window.openGuidedCall = function () { const me = (typeof curUser === "function") ? curUser() : null; GC = { soldBy: me ? me.id : "" }; window.GCALL = true; render(); };
window.gcExit = function () { window.GCALL = false; GC = {}; if (typeof render === "function") render(); };

function gcStep(n, title, say, fields) {
  return `<div class="card"><div style="font-weight:800;margin-bottom:4px"><span style="color:var(--accent)">${n}</span> · ${esc(title)}</div><div class="note" style="white-space:normal${fields ? ";margin-bottom:8px" : ""}">🗣️ ${esc(say)}</div>${fields || ""}</div>`;
}

/* next 2 weeks — crew availability + existing jobs, so you can offer a real day on the call */
function gcAvailStrip() {
  const mem = (typeof schedMembers === "function") ? schedMembers() : [];
  if (!mem.length) return "";
  let h = `<div class="card"><div style="font-weight:800;margin-bottom:4px">📅 Next 2 weeks — what day can you offer?</div><div class="sub" style="white-space:normal;margin-bottom:6px">"avail" = crew free that day. Pick an open day to send them for the quote (or the job).</div>`;
  const base = new Date();
  for (let i = 0; i < 14; i++) {
    const dt = new Date(base.getTime() + i * 86400000);
    const ds = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    const avail = mem.filter(u => { const a = (typeof availOn === "function") ? availOn(u, ds) : { status: "unknown" }; return a.status === "on" || a.status === "partial"; }).length;
    const jobs = (typeof actJ === "function") ? actJ().filter(j => !j.done && j.date === ds).length : 0;
    const lbl = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    h += `<div class="li" style="padding:4px 0"><div class="grow"><div class="nm" style="font-size:14px">${i === 0 ? "Today · " : ""}${esc(lbl)}</div></div><span class="sub" style="${avail === 0 ? "color:var(--danger)" : avail >= mem.length ? "color:var(--accent)" : ""}">${avail} avail${jobs ? " · " + jobs + " job" + (jobs > 1 ? "s" : "") : ""}</span></div>`;
  }
  return h + `</div>`;
}

/* quote-now category picks (simple, known jobs — junk, a wash). Saves the customer + jumps into pricing. */
function gcQuotePick() {
  const list = (typeof WZ_SVC !== "undefined" && WZ_SVC[S.biz]) ? WZ_SVC[S.biz].filter(s => s[0] !== "parking") : [];
  if (!list.length) return "";
  return `<div class="card" style="border-left:4px solid var(--accent)"><div style="font-weight:800;margin-bottom:4px">📞 Simple enough to quote right now?</div><div class="sub" style="white-space:normal;margin-bottom:8px">For known jobs (e.g. junk — "a fridge, a couch, a chair, 2nd floor") you can price it on the call. Pick the service → it saves them + drops you into pricing.</div><div class="grid2">` + list.map(s => `<button class="btn ghost" style="text-align:left;margin-bottom:8px" onclick="gcQuoteWith('${s[0]}')">${esc(s[1])}</button>`).join("") + `</div></div>`;
}

function rGuidedCall() {
  const _a = document.activeElement, _aid = _a && _a.id, _s = _a ? _a.selectionStart : 0, _e = _a ? _a.selectionEnd : 0;
  const me = (typeof curUser === "function") ? curUser() : null, youName = me ? me.username : "[you]";
  let h = `<div class="secthd"><h2>📞 Live call — I've got you</h2><button class="btn ghost sm" onclick="gcExit()">✕ Close</button></div>`;
  h += `<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">Breathe — you've got this. Work top to bottom as you talk; I'll capture it. <b>Don't quote a price on the phone for anything you haven't seen</b> — for those, the win is booking a free on-site quote. Simple, known jobs you can quote on the call (picks below).</div></div>`;
  h += gcStep("1", "Open warm + get their name", `"Thanks for calling OBX Lot Solutions — this is ${me ? me.username : "[you]"}. Who do I have the pleasure of speaking with?"  → then use their name the rest of the call.`, `<input id="gc_name" placeholder="Their name" value="${esc(GC.name || "")}" oninput="GC.name=this.value" autocomplete="off">`);
  h += gcStep("2", "Let them talk — what do they need?", `"Great to meet you, [name]. So tell me what's going on — what are you looking to get done?"  → Then LISTEN. Don't interrupt, don't jump to price. People buy when they feel heard.`, `<textarea id="gc_need" placeholder="What they need + key details" oninput="GC.need=this.value">${esc(GC.need || "")}</textarea>`);
  h += gcStep("3", "Where & when", `"Got it. What's the property address? … And when were you hoping to have it done?"  → The address lets you price + map it; urgency means you can hold your price.`, `<input id="gc_addr" placeholder="Property address" value="${esc(GC.address || "")}" oninput="GC.address=this.value" autocomplete="off"><input id="gc_when" placeholder="Timeline / urgency (ASAP, this month…)" value="${esc(GC.timeline || "")}" oninput="GC.timeline=this.value" autocomplete="off" style="margin-top:6px">`);
  h += gcStep("4", "Build trust (10 seconds)", `"We're local, we show up when we say we will, and the quote's free. We do a lot of this out here on the Outer Banks."  → You're the reliable local pro — that's your edge. Don't undersell it.`, "");
  h += gcStep("5", "Lock their contact", `"Let me grab your info so I can follow up and get you the quote."  → You've got their number from the call — confirm it, then grab the email.`, `<input id="gc_phone" placeholder="Phone" inputmode="tel" value="${esc(GC.phone || "")}" oninput="GC.phone=this.value" autocomplete="off"><input id="gc_email" placeholder="Email" inputmode="email" value="${esc(GC.email || "")}" oninput="GC.email=this.value" autocomplete="off" style="margin-top:6px"><input id="gc_company" placeholder="Company / property mgmt (if any)" value="${esc(GC.company || "")}" oninput="GC.company=this.value" autocomplete="off" style="margin-top:6px">`);
  h += gcStep("6", "CLOSE — set the next step (never skip this)", `"I'd love to swing by and give you an honest free quote — does [day] or [day] work better?"  → Always leave the call with a concrete next step. "I'll call you back" kills the sale. Check the calendar below and offer a real open day.`, "");
  h += gcAvailStrip();
  h += gcQuotePick();
  h += `<div class="card" style="border-left:4px solid var(--accent)"><div style="font-weight:800;margin-bottom:6px">Couldn't quote on the phone? Save the call:</div>
    <button class="btn acc" style="width:100%;margin-bottom:8px" onclick="gcFinish('visit')">📅 Save + book an on-site quote visit</button>
    <button class="btn ghost" style="width:100%" onclick="gcFinish('lead')">📇 Save as a lead to follow up</button></div>`;
  view.innerHTML = h;
  if (_aid) { const el = document.getElementById(_aid); if (el) { el.focus(); try { el.setSelectionRange(_s, _e); } catch (ex) {} } }
}

/* save the customer (and property) captured on the call; returns {c, prop} */
function gcSaveCustomer(status) {
  const d = D(), me = (typeof curUser === "function") ? curUser() : null;
  const c = { id: uid(), name: GC.name || "New lead", company: GC.company || "", phone: GC.phone || "", email: GC.email || "", town: "", type: "Residential", status: status, source: "Phone call", soldBy: me ? me.id : "", manager: "", notes: [], next: "" };
  if (GC.need) c.notes.push({ t: new Date().toLocaleString(), text: "📞 Call: " + GC.need + (GC.timeline ? " · when: " + GC.timeline : "") });
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
/* quote-now: save the customer + open the wizard straight into the chosen service's pricing */
window.gcQuoteWith = function (svcKey) {
  if (!(GC.name || GC.phone)) { if (!confirm("No name or phone captured yet — save & quote anyway?")) return; }
  if (typeof WZON === "undefined") { alert("Quote builder unavailable."); return; }
  const r = gcSaveCustomer("Quoted");
  WZ = gcWizFor(r.c, r.prop); WZON = true; TAB = "quotes"; window.GCALL = false; GC = {};
  render();
  if (svcKey && typeof wizSetSvc === "function") wizSetSvc(svcKey);   // jump to that service's calc
};
window.gcFinish = function (outcome) {
  if (!(GC.name || GC.phone)) { if (!confirm("No name or phone captured yet — save anyway?")) return; }
  const r = gcSaveCustomer(outcome === "lead" ? "Lead" : "Quoted"), name = r.c.name;
  if (outcome === "quote" && typeof WZON !== "undefined") { WZ = gcWizFor(r.c, r.prop); window.GCALL = false; GC = {}; WZON = true; TAB = "quotes"; render(); return; }
  window.GCALL = false; GC = {};
  if (outcome === "visit") { TAB = "schedule"; if (typeof render === "function") render(); alert("Saved " + name + ". Now book the on-site quote visit on the schedule."); }
  else { TAB = "accounts"; if (typeof render === "function") render(); alert("Saved " + name + " as a lead — follow-up set for 2 days out."); }
};
