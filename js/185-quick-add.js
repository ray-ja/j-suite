/* ---------- ONE "+" EVERYWHERE (js/185) ----------
   Ray, 2026-09-22, UX audit: "when I'm putting information in… I'm bouncing between different jobs, 15 minutes
   here, 15 minutes there." The "+" existed on 16 screens and did something different on each; a customer was
   three taps from the right tab, an expense four, a punch only from Time or a job page.

   NOW: the floating "+" is on every screen (signed in) and opens ONE sheet. First row = what this screen's own
   "+" used to do (so nothing regresses), then the same short list everywhere: Customer · Lead · Quote · Job ·
   To-do · Receipt · Expense · Clock in. Each row calls the module that already owns that record; this file
   creates nothing itself. Rows are gated by the same role/org check as the menu (navCanSee), so a crew member
   never sees Expense, and a personal org never sees Quote. Pure helper is node-testable (quick-add-tests.js). */
const QUICK_ADD_ROWS = [
  { key: "customer", tab: "accounts",  icon: "👤", label: "Customer",  fn: "openCustomer" },
  { key: "lead",     tab: "leads",     icon: "📞", label: "Lead / call", fn: "openGuidedCall" },
  { key: "quote",    tab: "quotes",    icon: "🧾", label: "Quote",     fn: "openQuote" },
  { key: "job",      tab: "schedule",  icon: "🔨", label: "Job",       fn: "openJob" },
  { key: "todo",     tab: "todo",      icon: "✅", label: "To-do",     fn: "openTodo" },
  { key: "receipt",  tab: "receipts",  icon: "📸", label: "Receipt",   fn: "capQuickCapture", alt: "rcptPickFiles" },
  { key: "expense",  tab: "finance",   icon: "💸", label: "Expense",   fn: "openExpense" },
  { key: "clockin",  tab: "time",      icon: "⏱️", label: "Clock in",  fn: "tcClockInFormHTML" },
  { key: "file",     tab: "files",     icon: "📎", label: "File",      fn: "pfPick" }
];
/* which universal rows to show: the tab must be visible to this user in this org, and the function must exist.
   `has(name)` and `see(tab)` are injected so the picker stays pure. */
function quickAddPick(rows, see, has) {
  return (rows || []).filter(r => r && (typeof see !== "function" || see(r.tab)) && (has(r.fn) || (r.alt && has(r.alt))));
}
if (typeof window !== "undefined") {
  const has = name => typeof window[name] === "function";
  const see = tab => { try { return (typeof navCanSee === "function") ? navCanSee(tab) : true; } catch (e) { return true; } };
  function quickAddRun(key) {
    const r = QUICK_ADD_ROWS.find(x => x.key === key); if (!r) return;
    if (typeof closeModal === "function") closeModal();
    if (r.key === "clockin") {
      const open = (typeof tcMyOpen === "function") ? tcMyOpen() : null;
      if (open) { if (typeof clockPillTap === "function") clockPillTap(); return; }   // already on the clock → the shift
      if (typeof modal === "function" && has("tcClockInFormHTML")) modal("Clock in", tcClockInFormHTML(null));
      return;
    }
    if (has(r.fn)) window[r.fn](); else if (r.alt && has(r.alt)) window[r.alt]();
  }
  window.quickAddRun = quickAddRun;
  window.quickAddOpen = function () {
    const E = (typeof esc === "function") ? esc : (s => String(s == null ? "" : s));
    const meta = (typeof TAB_META !== "undefined") ? TAB_META : {};
    let h = "";
    /* this screen's own add first, unless it is one of the universal rows already */
    try {
      const own = (typeof fabAction === "function") ? fabAction(TAB) : null;
      const dup = QUICK_ADD_ROWS.some(r => r.tab === TAB || (TAB === "jobs" && r.key === "quote"));
      if (own && !dup) {
        const m = meta[TAB] || {};
        h += `<div class="pmhead">On this screen</div><div class="pmgrid"><button class="pmbtn" onclick="closeModal();(fabAction(TAB)||function(){})()"><span class="ic">${E(m.i || "➕")}</span><span>Add to ${E(m.l || TAB)}</span></button></div>`;
      }
    } catch (e) {}
    const rows = quickAddPick(QUICK_ADD_ROWS, see, has);
    const clocked = (typeof tcMyOpen === "function") ? !!tcMyOpen() : false;
    h += `<div class="pmhead">New</div><div class="pmgrid">` + rows.map(r => {
      const label = (r.key === "clockin" && clocked) ? "On the clock" : r.label;
      return `<button class="pmbtn" onclick="quickAddRun('${E(r.key)}')"><span class="ic">${r.icon}</span><span>${E(label)}</span></button>`;
    }).join("") + `</div>`;
    if (!rows.length) h += `<div class="sub">Nothing to add from here.</div>`;
    if (typeof modal === "function") modal("Add", h);
  };
  /* the "+" is on every screen now; the per-screen action moved INTO the sheet instead of being the button */
  if (typeof applyFab === "function") {
    applyFab = function () {
      try {
        const b = document.getElementById("fab"); if (!b) return;
        b.style.display = ""; b.title = "Add"; b.onclick = window.quickAddOpen;
      } catch (e) {}
    };
    window.applyFab = applyFab;
  }
  window.quickAddPick = quickAddPick; window.QUICK_ADD_ROWS = QUICK_ADD_ROWS;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { quickAddPick, QUICK_ADD_ROWS }; }
