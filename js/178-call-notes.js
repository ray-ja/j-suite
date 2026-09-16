/* ---------- WHAT THEY ASKED FOR ON THE CALL (js/178) ----------
   Ray, 2026-09-16: "when I talk to him on the phone, there's a box where I fill out what they want us to get…
   it seems like it's inaccessible after I fill it out. I'm clicking on the job and it just doesn't come up."

   The Call Lead screen (js/66) saves that box as a note ON THE CUSTOMER ("📞 Call: …"). The job never got a copy,
   so the job page showed only its own empty Notes box. This surfaces every 📞 Call note from the job's customer
   at the top of the job page's Notes card, read-only, newest first — so the list of what to haul is on the job
   the crew opens at 3 o'clock. Nothing is copied or duplicated; the customer record stays the one source. */
function jobCallNotes(j) {
  if (!j || !j.customerId || typeof D !== "function") return [];
  const c = (D().customers || []).find(x => x && x.id === j.customerId && !x.deleted);
  const notes = (c && Array.isArray(c.notes)) ? c.notes : [];
  return notes.filter(n => n && /^📞/.test(String(n.text || ""))).map(n => ({ t: n.t || "", text: String(n.text).replace(/^📞\s*Call:\s*/, "").trim() })).reverse();
}
function jobCallNotesHTML(j) {
  const list = jobCallNotes(j); if (!list.length) return "";
  return `<div style="margin-bottom:8px;padding:8px 10px;background:var(--soft);border-radius:8px"><div class="sub" style="font-weight:700;margin-bottom:2px">📞 What they asked for on the call</div>`
    + list.map(n => `<div style="font-size:14px;white-space:pre-wrap;margin-top:2px">${esc(n.text)}</div>${n.t ? `<div class="sub" style="font-size:11px">${esc(n.t)}</div>` : ""}`).join("") + `</div>`;
}
if (typeof window !== "undefined") { window.jobCallNotesHTML = jobCallNotesHTML; window.jobCallNotes = jobCallNotes; }
if (typeof module !== "undefined" && module.exports) module.exports = { jobCallNotes: jobCallNotes };
