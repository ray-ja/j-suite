/* ---------- LIVE CALL HELPER ----------
   Someone calls wanting a quote. You're an engineer, not a salesperson — so the app runs the call.
   A single top-to-bottom page: the exact words to say (psychologically-ordered) + fields that capture
   what you learn. Ends by saving the customer + (optionally) launching the quote or booking a visit.
   Launched via openGuidedCall() (a flag, GCALL, checked in render() so sync re-renders keep it open). */
let GC = {};
window.openGuidedCall = function () { const me = (typeof curUser === "function") ? curUser() : null; GC = { soldBy: me ? me.id : "" }; window.GCALL = true; render(); };
window.gcExit = function () { window.GCALL = false; GC = {}; if (typeof render === "function") render(); };

function gcStep(n, title, say, fields) {
  return `<div class="card"><div style="font-weight:800;margin-bottom:4px"><span style="color:var(--accent)">${n}</span> · ${esc(title)}</div><div class="note" style="white-space:normal${fields ? ";margin-bottom:8px" : ""}">🗣️ ${esc(say)}</div>${fields || ""}</div>`;
}

function rGuidedCall() {
  const _a = document.activeElement, _aid = _a && _a.id, _s = _a ? _a.selectionStart : 0, _e = _a ? _a.selectionEnd : 0;
  const me = (typeof curUser === "function") ? curUser() : null, youName = me ? me.username : "[you]";
  let h = `<div class="secthd"><h2>📞 Live call — I've got you</h2><button class="btn ghost sm" onclick="gcExit()">✕ Close</button></div>`;
  h += `<div class="card" style="background:var(--soft)"><div class="sub" style="white-space:normal">Breathe — you've got this. Work top to bottom as you talk; I'll capture it. <b>Don't quote a price on the phone for anything you haven't seen</b> — the win on this call is booking a free on-site quote (or a quick one for a simple, known job).</div></div>`;
  h += gcStep("1", "Open warm + get their name", `"Thanks for calling OBX Lot Solutions — this is ${youName}. Who do I have the pleasure of speaking with?"  → then use their name the rest of the call.`, `<input id="gc_name" placeholder="Their name" value="${esc(GC.name || "")}" oninput="GC.name=this.value" autocomplete="off">`);
  h += gcStep("2", "Let them talk — what do they need?", `"Great to meet you, [name]. So tell me what's going on — what are you looking to get done?"  → Then LISTEN. Don't interrupt, don't jump to price. People buy when they feel heard.`, `<textarea id="gc_need" placeholder="What they need + key details" oninput="GC.need=this.value">${esc(GC.need || "")}</textarea>`);
  h += gcStep("3", "Where & when", `"Got it. What's the property address? … And when were you hoping to have it done?"  → The address lets you price + map it; urgency means you can hold your price.`, `<input id="gc_addr" placeholder="Property address" value="${esc(GC.address || "")}" oninput="GC.address=this.value" autocomplete="off"><input id="gc_when" placeholder="Timeline / urgency (ASAP, this month…)" value="${esc(GC.timeline || "")}" oninput="GC.timeline=this.value" autocomplete="off" style="margin-top:6px">`);
  h += gcStep("4", "Build trust (10 seconds)", `"We're local, we show up when we say we will, and the quote's free. We do a lot of this out here on the Outer Banks."  → You're the reliable local pro — that's your edge. Don't undersell it.`, "");
  h += gcStep("5", "Lock their contact", `"Let me grab your info so I can follow up and get you the quote."  → You've got their number from the call — confirm it, then grab the email.`, `<input id="gc_phone" placeholder="Phone" inputmode="tel" value="${esc(GC.phone || "")}" oninput="GC.phone=this.value" autocomplete="off"><input id="gc_email" placeholder="Email" inputmode="email" value="${esc(GC.email || "")}" oninput="GC.email=this.value" autocomplete="off" style="margin-top:6px"><input id="gc_company" placeholder="Company / property mgmt (if any)" value="${esc(GC.company || "")}" oninput="GC.company=this.value" autocomplete="off" style="margin-top:6px">`);
  h += gcStep("6", "CLOSE — set the next step (never skip this)", `"I'd love to swing by and give you an honest free quote — does [day] or [day] work better for you?"  → Always leave the call with a concrete next step booked. "I'll call you back" kills the sale. Simple, known job? You can quote it on the spot.`, "");
  h += `<div class="card" style="border-left:4px solid var(--accent)"><div style="font-weight:800;margin-bottom:6px">How'd the call end?</div>
    <button class="btn acc" style="width:100%;margin-bottom:8px" onclick="gcFinish('quote')">💾 Save + build the quote now</button>
    <button class="btn ghost" style="width:100%;margin-bottom:8px" onclick="gcFinish('visit')">📅 Save + book an on-site quote visit</button>
    <button class="btn ghost" style="width:100%" onclick="gcFinish('lead')">📇 Save as a lead to follow up</button></div>`;
  view.innerHTML = h;
  if (_aid) { const el = document.getElementById(_aid); if (el) { el.focus(); try { el.setSelectionRange(_s, _e); } catch (ex) {} } }
}

window.gcFinish = function (outcome) {
  if (!(GC.name || GC.phone)) { if (!confirm("No name or phone captured yet — save anyway?")) return; }
  const d = D(), me = (typeof curUser === "function") ? curUser() : null;
  const c = { id: uid(), name: GC.name || "New lead", company: GC.company || "", phone: GC.phone || "", email: GC.email || "", town: "", type: "Residential", status: outcome === "lead" ? "Lead" : "Quoted", source: "Phone call", soldBy: me ? me.id : "", manager: "", notes: [], next: "" };
  if (GC.need) c.notes.push({ t: new Date().toLocaleString(), text: "📞 Call: " + GC.need + (GC.timeline ? " · when: " + GC.timeline : "") });
  if (outcome === "lead") { const t = new Date(Date.now() + 2 * 86400000); c.next = t.toISOString().slice(0, 10); }   // follow up in 2 days
  if (typeof touch === "function") touch(c); if (!d.customers) d.customers = []; d.customers.push(c);
  let prop = null;
  if (GC.address) { prop = { id: uid(), label: "Main", address: GC.address, accessNotes: "", lat: null, lng: null, customerIds: [c.id], updatedAt: now() }; if (!d.properties) d.properties = []; d.properties.push(prop); if (typeof geocodeProp === "function") geocodeProp(prop); }
  save();
  const phone = GC.phone || "", address = GC.address || ""; window.GCALL = false; GC = {};
  if (outcome === "quote" && typeof WZON !== "undefined") {
    WZ = { step: "pick", cust: { id: c.id, name: c.name, phone: phone, address: address, source: "Phone call", notes: "", propertyId: prop ? prop.id : "", soldBy: me ? me.id : "" }, items: [], recurring: false, disc: 0, discPct: null, miles: 0, hours: 0, crewN: 1, disposalTrip: false, haul: "pickup", zone: "local", travelMiles: null, svc: null, inp: {}, deep: {}, deepMods: {}, deepSearch: "", id: null, invoiced: false, paid: false, paymentLink: "", finalPrice: 0, adjNote: "" };
    WZON = true; TAB = "quotes"; render();
  } else if (outcome === "visit") { TAB = "schedule"; if (typeof render === "function") render(); alert("Saved " + c.name + ". Now book the on-site quote visit on the schedule."); }
  else { TAB = "accounts"; if (typeof render === "function") render(); alert("Saved " + c.name + " as a lead — follow-up set for 2 days out."); }
};
