/* ---------- PROJECT GUIDE (js/183) — the one card a build job needs on site ----------
   Ray, 2026-09-22, on the waterfall job: "i dont see the estimate link or other stuff i will need like materials
   cost and where to get them and what type to get etc. like a project guide."
   A job may carry `j.guide`:
     { intro, estimates:[{label,url,price,deposit,depositUrl}], links:[{label,url}],
       materials:[{item,spec,where,qty,price,bought}], steps:[{text,done}], measurements:[text], open:[text] }
   Rendered at the top of the job page (Overview tab). Materials tick off as bought and steps as done; both persist on
   the job record (LWW like everything else). Pure helpers are node-testable. */
function guideProgress(g) {
  const m = (g && g.materials) || [], s = (g && g.steps) || [];
  return { materialsBought: m.filter(x => x && x.bought).length, materials: m.length, stepsDone: s.filter(x => x && x.done).length, steps: s.length,
    materialsTotal: Math.round(m.reduce((t, x) => t + ((+x.price || 0) * (+x.qty || 1)), 0) * 100) / 100 };
}
function guideMoney(n) { return "$" + (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
if (typeof window !== "undefined") {
  const E = s => (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s);
  const link = (u, label) => `<a href="${E(u)}" target="_blank" rel="noopener" style="color:var(--brand-text);font-weight:700">${E(label)}</a>`;
  window.guideToggle = function (jobId, list, i) {
    const j = D().jobs.find(x => x && x.id === jobId); if (!j || !j.guide || !Array.isArray(j.guide[list]) || !j.guide[list][i]) return;
    const row = j.guide[list][i]; const key = list === "materials" ? "bought" : "done"; row[key] = !row[key]; row[key + "At"] = row[key] ? now() : null;
    touch(j); save(); render();
  };
  window.jobGuideHTML = function (j) {
    const g = j && j.guide; if (!g) return "";
    const p = guideProgress(g);
    let h = `<div class="card" style="border-left:4px solid var(--brand,#1B2A4E)"><div style="font-weight:800;margin-bottom:6px;font-size:16px">📘 Project guide</div>`;
    if (g.intro) h += `<div class="sub" style="white-space:normal;margin-bottom:10px">${E(g.intro).replace(/\n/g, "<br>")}</div>`;
    if (Array.isArray(g.estimates) && g.estimates.length) {
      h += `<div style="font-weight:800;margin:8px 0 4px">💵 Estimates</div>`;
      g.estimates.forEach(e => { h += `<div class="li" style="padding:8px 0"><div class="grow"><div class="nm" style="font-size:14px">${E(e.label)}${e.price ? ` · <b>${E(e.price)}</b>` : ""}</div><div class="sub" style="white-space:normal">${e.url ? link(e.url, "Written quote") : ""}${e.depositUrl ? ` · ${link(e.depositUrl, "Deposit" + (e.deposit ? " " + e.deposit : ""))}` : ""}${e.note ? ` · ${E(e.note)}` : ""}</div></div></div>`; });
    }
    if (Array.isArray(g.links) && g.links.length) h += `<div class="sub" style="white-space:normal;margin:6px 0 10px">🔗 ${g.links.map(l => link(l.url, l.label)).join(" · ")}</div>`;
    if (Array.isArray(g.measurements) && g.measurements.length) h += `<div style="font-weight:800;margin:10px 0 4px">📐 Measurements</div><div class="sub" style="white-space:normal;line-height:1.6">${g.measurements.map(E).join("<br>")}</div>`;
    if (Array.isArray(g.materials) && g.materials.length) {
      h += `<div style="font-weight:800;margin:12px 0 4px">🧱 Materials <span class="sub" style="font-weight:400">· ${p.materialsBought}/${p.materials} bought · about ${guideMoney(p.materialsTotal)}</span></div>`;
      g.materials.forEach((m, i) => { h += `<label class="li" style="cursor:pointer;padding:8px 0;align-items:flex-start"><input type="checkbox" style="width:22px;height:22px;flex:0 0 auto;margin-top:2px" ${m.bought ? "checked" : ""} onchange="guideToggle('${j.id}','materials',${i})"><div class="grow"><div class="nm" style="font-size:14px;${m.bought ? "text-decoration:line-through;opacity:.6" : ""}">${E(m.item)}${m.qty && m.qty !== 1 ? ` × ${E(m.qty)}` : ""}${m.price ? ` · ${guideMoney((+m.price || 0) * (+m.qty || 1))}` : ""}</div><div class="sub" style="white-space:normal">${m.spec ? E(m.spec) + " " : ""}${m.where ? `<b>Where:</b> ${m.url ? link(m.url, m.where) : E(m.where)}` : ""}</div></div></label>`; });
    }
    if (Array.isArray(g.steps) && g.steps.length) {
      h += `<div style="font-weight:800;margin:12px 0 4px">🔨 Order of work <span class="sub" style="font-weight:400">· ${p.stepsDone}/${p.steps} done</span></div>`;
      g.steps.forEach((s, i) => { h += `<label class="li" style="cursor:pointer;padding:7px 0;align-items:flex-start"><input type="checkbox" style="width:22px;height:22px;flex:0 0 auto;margin-top:1px" ${s.done ? "checked" : ""} onchange="guideToggle('${j.id}','steps',${i})"><div class="grow"><div class="nm" style="font-size:14px;font-weight:600;${s.done ? "text-decoration:line-through;opacity:.6" : ""}">${i + 1}. ${E(s.text)}</div>${s.note ? `<div class="sub" style="white-space:normal">${E(s.note)}</div>` : ""}</div></label>`; });
    }
    if (Array.isArray(g.open) && g.open.length) h += `<div style="font-weight:800;margin:12px 0 4px">❓ Still open</div><div class="sub" style="white-space:normal;line-height:1.6">${g.open.map(x => "• " + E(x)).join("<br>")}</div>`;
    h += `</div>`;
    return h;
  };
}
if (typeof module !== "undefined" && module.exports) { module.exports = { guideProgress, guideMoney }; }
