/* ---------- TODAY, ONE QUESTION (js/199) — Phase 11 of the UX reorg ----------
   Ray, 2026-09-27, a dark 2560px screenshot of Today: "an overwhelming amount of text and boxes". Twelve
   cards, two forms (clock in, stand-up), a chat, a receipt button, four separate lists of things to do.

   THE RULES (NN/g dashboards, Gestalt grouping, progressive disclosure):
     1. ONE QUESTION. Today answers "what needs me?" A header strip says it in one line, with the numbers.
     2. ONE INBOX. Approvals, follow-ups, to-dos, service due, payment plans are ONE list ("Needs you"): one
        line per item, a type mark on the left, one action on the right. Six rows, then "All N".
     3. ONE MONEY PANEL. Open quotes, confirmed, to send, awaiting, payouts are sub-heads of one card.
     4. FORMS FOLD. Clock in is a button until pressed (desktop; the phone crew keep the open form). The
        stand-up's textareas hide behind "Write my stand-up" until there is something to say.
     5. COLUMNS MEAN SOMETHING. Needs you | Money | The day. A real grid, never a newspaper flow.
     6. WHAT IS ELSEWHERE IS NOT HERE. Snap a receipt lives on "+"; Cap's read-back toggle and the Google
        Business Profile instructions leave the desktop.
   Post-render after js/197 (which triages and quiets) and js/198. Nothing is deleted: every original node
   stays in the DOM, hidden or moved, so every handler still fires. Pure helpers tested in today3-tests.js. */
var T3_NEEDS = /approvals|follow-ups|top to-dos|equipment service|payment plans|need(s)? cleaning|recurring visit|quick-start|quick start/i;
var T3_MONEY = /awaiting payment|open quotes|payouts|invoices to send|confirmed jobs|not expecting|next 30 days|cash on hand|fixed costs|left after|clicks yesterday|ad spend/i;
/* the money panel reads top-down from what is owed to what is paid out. Pure. */
var T3_MONEY_ORDER = [/cash on hand/i, /awaiting payment/i, /invoices to send/i, /not expecting/i, /next 30 days/i, /fixed costs/i, /confirmed jobs/i, /open quotes/i, /payouts/i, /left after/i];
function t3MoneyRank(title) { var s = String(title || ""); for (var i = 0; i < T3_MONEY_ORDER.length; i++) if (T3_MONEY_ORDER[i].test(s)) return i; return T3_MONEY_ORDER.length; }
function t3Col(title) { var s = String(title || ""); if (T3_NEEDS.test(s)) return "needs"; if (T3_MONEY.test(s)) return "money"; return "day"; }
/* the type mark for an inbox row: the head's leading emoji, else a dot. Pure. */
function t3Icon(headText) {
  var s = String(headText || "").trim();
  var m = s.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u);
  return m ? m[1] : "•";
}
/* dollars in a list of strings ("$1,770", "$15 due"), summed. Pure. */
function t3Money(texts) {
  var sum = 0; (texts || []).forEach(function (t) { var m = String(t || "").match(/\$\s?([\d,]+(?:\.\d+)?)/); if (m) sum += parseFloat(m[1].replace(/,/g, "")) || 0; });
  return Math.round(sum * 100) / 100;
}
function t3Fmt(n) { n = +n || 0; return "$" + (n % 1 ? n.toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
/* inbox order across types: Cap's approvals first (he is waiting), then overdue, then due today, then the
   rest; stable inside a rank. Pure. */
function t3Urgency(src, text) {
  var t = String(text || ""), sr = String(src || "");
  if (/approvals/i.test(sr)) return 0;
  if (/overdue/i.test(t)) return 1;
  if (/due today|today\b/i.test(t) && !/no jobs today/i.test(t)) return 2;
  if (/no date|not yet done|set the hour meter/i.test(t)) return 4;
  return 3;
}
/* a to-do's title is often a paragraph. Cut it into a short head and the rest: at the first clause break
   (colon, dash, semicolon, sentence end) if that comes early enough, else at a word boundary. Pure. */
function t3Split(text, max) {
  var t = String(text || "").replace(/\s+/g, " ").trim(); max = max || 56;
  if (t.length <= max) return { head: t, rest: "" };
  var m = t.match(/^(.{12,}?)(?::\s|\s[—–-]\s|;\s|\.\s|\?\s)(.+)$/);
  if (m && m[1].length <= max * 1.3) return { head: m[1].trim(), rest: m[2].trim() };
  var cut = t.lastIndexOf(" ", max); if (cut < 24) cut = max;
  return { head: t.slice(0, cut).trim() + "…", rest: t };
}
/* leading pictographs on a line ("📞 Text 9/19…", "⚠️ Engine oil change") — the row already has a mark. Pure. */
function t3Strip(text) { return String(text || "").replace(/^(?:\s*(?:\p{Extended_Pictographic}|\uFE0F|\u200D|[⚠️✅❌⏳📞🛠🔧])+\s*)+/u, "").trim(); }
/* how many of the crew are working today from their status labels. Pure. */
function t3Working(labels) { return (labels || []).filter(function (l) { return !/not confirmed|^off$|time off|^$/i.test(String(l || "").trim()); }).length; }
/* a row's menu (Ray, 2026-09-27: "a little three dot menu… delete, mark not urgent, push it to the next day").
   Which actions fit which source. Pure. */
function t3Actions(src) {
  var sr = String(src || "");
  if (/awaiting payment/i.test(sr)) return ["nexp"];
  if (/not expecting/i.test(sr)) return ["exp"];
  if (/to-dos/i.test(sr)) return ["tomorrow", "week", "low", "delete"];
  if (/follow-ups/i.test(sr)) return ["tomorrow", "week", "delete"];
  return [];
}
/* an ISO date shifted by n days. Pure. */
function t3Shift(iso, n) { var d = iso ? new Date(iso + "T12:00:00") : new Date(); if (isNaN(d.getTime())) d = new Date(); d.setDate(d.getDate() + (+n || 0)); return d.toISOString().slice(0, 10); }
/* "Done today" (Ray, 2026-09-27: "I accidentally checked something off. There should be a way right there to see
   what I've checked off today and undo it."). A per-device journal of what was ticked, logged, pushed or deleted
   from Needs you; today's entries show under the list with an Undo each. Pure bits here. */
function t3SameDay(a, b) { var x = new Date(+a || 0), y = new Date(+b || 0); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); }
function t3JournalTrim(list, now, max) { max = max || 50; var keep = (list || []).filter(function (e) { return e && (now - (+e.at || 0)) < 7 * 864e5; }); return keep.slice(-max); }
/* ARRANGE (Ray, 2026-09-27: "make it so I can reorder the cards myself, right-click or a long press").
   The saved order is a list of tile keys per group; tiles not in it keep their default order after the saved
   ones. ◀ ▶ arrows and drag both edit the same list. Pure. */
function t3Order(keys, saved) {
  keys = keys || []; saved = (saved || []).filter(function (k) { return keys.indexOf(k) >= 0; });
  return saved.concat(keys.filter(function (k) { return saved.indexOf(k) < 0; }));
}
function t3MoveKey(keys, key, dir) {
  var a = (keys || []).slice(), i = a.indexOf(key); if (i < 0) return a;
  var j = Math.max(0, Math.min(a.length - 1, i + dir)); if (j === i) return a;
  a.splice(i, 1); a.splice(j, 0, key); return a;
}
/* the header strip's chips from the counts. stats = {needs, owed, owedN, jobs, clockedIn}. Pure. */
function t3Chips(st) {
  st = st || {}; var out = [];
  out.push({ key: "needs", text: st.needs > 0 ? (st.needs + " need" + (st.needs === 1 ? "s" : "") + " you") : "Nothing needs you", hot: st.needs > 0 });
  if (st.owedN > 0) out.push({ key: "money", text: t3Fmt(st.owed) + " invoiced · " + st.owedN + " invoice" + (st.owedN === 1 ? "" : "s"), hot: false });
  return out;   // the day's own numbers live on the day column's stat row, not here twice
}
if (typeof window !== "undefined") {
  var T3 = { clock: false, standup: false, all: false };   // what the user opened this session
  var t3E = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  var t3Tier = function () { return (typeof dkTier === "function") ? dkTier(window.innerWidth) : "compact"; };
  var t3Hidden = function (el) { return el.style.display === "none"; };
  /* blocks after js/197 ran: a .db-quiet line owns the hidden head + nodes behind it */
  function t3Blocks(col) {
    var out = [], cur = null;
    Array.prototype.slice.call(col.children).forEach(function (k) {
      if (k.classList.contains("db-quiet")) { cur = { title: (k.querySelector(".t") || k).textContent.trim(), quiet: true, line: k, head: null, nodes: [] }; out.push(cur); return; }
      var isHead = k.classList.contains("secthd") || k.tagName === "H2";
      if (isHead) { if (t3Hidden(k) && cur && cur.quiet && !cur.head) { cur.head = k; return; } cur = { title: (k.querySelector("h2") || k).textContent.trim(), head: k, nodes: [] }; out.push(cur); return; }
      /* a quiet block owns only the HIDDEN nodes behind its line; the next visible node is a new block */
      if (!cur || (cur.quiet && !t3Hidden(k)) || (k.classList.contains("card") && !cur.quiet && cur.nodes.some(function (n) { return n.classList.contains("card"); }))) { cur = { head: null, nodes: [], title: "" }; out.push(cur); }
      cur.nodes.push(k);
      if (!cur.title) { var nm = k.querySelector(".nm, b, strong, h3"); cur.title = ((nm && nm.textContent) || k.textContent || "").trim().slice(0, 40); }
    });
    return out;
  }
  /* rule 7 (Ray, 2026-09-27: "things that expand should be able to collapse too"): one toggle for all folds.
     btn flips `cls` on `target`, swaps its own label, remembers the state in T3[key], and calls `after`. */
  function t3Toggle(btn, target, cls, openLabel, closeLabel, key, after) {
    var paint = function () { var open = !target.classList.contains(cls); btn.textContent = open ? closeLabel : openLabel; btn.classList.toggle("acc", !open && /clock in/i.test(openLabel)); btn.classList.toggle("ghost", open || !/clock in/i.test(openLabel)); };
    btn.onclick = function () { target.classList.toggle(cls); T3[key] = !target.classList.contains(cls); paint(); if (after) after(T3[key]); };
    paint();
  }
  function t3Move(target, b) { if (b.line) target.appendChild(b.line); if (b.head) target.appendChild(b.head); b.nodes.forEach(function (n) { target.appendChild(n); }); }
  function t3Head(text, count) { var h = document.createElement("div"); h.className = "secthd db-colhd"; h.innerHTML = "<h2>" + t3E(text) + "</h2>" + (count != null ? '<span class="ct">' + t3E(count) + "</span>" : ""); return h; }
  /* rule 2: the inbox */
  function t3Inbox(blocks) {
    var rows = [];
    blocks.forEach(function (b) {
      if (b.quiet) return;
      var icon = t3Icon(b.title);
      b.nodes.forEach(function (n) {
        if (!n.classList.contains("card")) return;
        var lis = Array.prototype.slice.call(n.querySelectorAll(":scope > .li, :scope > div > .li"));
        var stale = Array.prototype.slice.call(n.querySelectorAll(":scope > .row")).filter(function (r) { return !!r.querySelector("button.acc"); });
        var picked = stale.concat(lis);
        if (!picked.length && n.getAttribute("onclick")) picked = [n];   // a one-card nudge (needs cleaning, recurring) rides in as a row
        picked.forEach(function (r) { rows.push({ el: r, icon: icon, src: b.title }); });
      });
    });
    return rows;
  }
  /* the ⋯ menu on an inbox row: acts on the record behind the row through the same fields the screens use,
     soft-deletes only (deleted:true), then saves and re-renders. */
  var T3_LABELS = { tomorrow: "Push to tomorrow", week: "Next week", low: "Not urgent", delete: "Delete", nexp: "Not expecting this", exp: "Expecting this again" };
  function t3RecordFor(el, src) {
    var html = el.outerHTML, m;   // outerHTML: a follow-up row carries its openCustomer(...) on the row ITSELF
    if (/to-dos/i.test(src) && (m = html.match(/toggleTodo\('([^']+)'\)|openTodo\('([^']+)'\)/))) { var id = m[1] || m[2]; var td = ((typeof D === "function" && D().todos) || []).find(function (x) { return x && x.id === id; }); return td ? { kind: "todo", rec: td } : null; }
    if (/follow-ups/i.test(src) && (m = html.match(/openCustomer\('([^']+)'\)/))) { var c = ((typeof D === "function" && D().customers) || []).find(function (x) { return x && x.id === m[1]; }); return c ? { kind: "customer", rec: c } : null; }
    return null;
  }
  function t3Act(el, src, key) {
    if (key === "nexp" || key === "exp") { var qm = el.outerHTML.match(/openQuote\('([^']+)'\)|openInvoice\('([^']+)'\)/); if (qm && typeof recToggleDoubtful === "function") recToggleDoubtful(qm[1] || qm[2]); return; }
    var r = t3RecordFor(el, src); if (!r) { if (typeof toast === "function") toast("Couldn't find that record"); return; }
    var rec = r.rec, t = (typeof today === "function") ? today() : new Date().toISOString().slice(0, 10);
    var label = r.kind === "customer" ? (rec.name || rec.company || "lead") : (rec.title || "to-do");
    var undo = r.kind === "customer" ? { deleted: !!rec.deleted, next: rec.next || "" } : { deleted: !!rec.deleted, due: rec.due || "", priority: rec.priority || "" };
    t3Note({ kind: r.kind, id: rec.id, label: label, what: (T3_LABELS[key] || key).toLowerCase(), undo: undo });
    if (key === "delete") { var what = r.kind === "customer" ? (rec.name || rec.company || "this lead") : (rec.title || "this to-do"); if (!confirm("Delete " + what + "? It goes to the archive, not the trash.")) { t3Unnote(function (e) { return e.id === rec.id && e.what === "delete"; }); return; } rec.deleted = true; }
    else if (key === "tomorrow" || key === "week") { var due = t3Shift(t, key === "week" ? 7 : 1); if (r.kind === "todo") rec.due = due; else rec.next = due; }
    else if (key === "low") { if (r.kind === "todo") { rec.priority = "Low"; rec.due = t3Shift(rec.due || t, 7); } }
    rec.updatedAt = Date.now(); if (typeof touch === "function") touch(rec);
    if (typeof save === "function") save(); if (typeof render === "function") render();
  }
  function t3Menu(el, src) {
    var acts = t3Actions(src); if (!acts.length || el.querySelector(".db-dots")) return;
    var dots = document.createElement("button"); dots.className = "db-dots"; dots.textContent = "⋯"; dots.title = "More"; dots.setAttribute("aria-label", "More actions");
    dots.onclick = function (e) {
      e.stopPropagation(); e.preventDefault();
      var old = document.querySelector(".db-menu"); if (old) { var was = old.parentNode === el; old.remove(); if (was) return; }
      var menu = document.createElement("div"); menu.className = "db-menu";
      acts.forEach(function (k) { var b = document.createElement("button"); b.textContent = T3_LABELS[k] || k; if (k === "delete") b.classList.add("danger"); b.onclick = function (ev) { ev.stopPropagation(); menu.remove(); t3Act(el, src, k); }; menu.appendChild(b); });
      el.appendChild(menu);
      setTimeout(function () { var once = function () { menu.remove(); document.removeEventListener("click", once); }; document.addEventListener("click", once); menu.addEventListener("click", function () { document.removeEventListener("click", once); }); }, 0);
    };
    el.appendChild(dots); el.style.position = "relative";
  }
  /* ---- the journal ---- */
  var T3_JKEY = "jra_t3_done";
  function t3Journal() { try { return JSON.parse(localStorage.getItem(T3_JKEY) || "[]") || []; } catch (e) { return []; } }
  function t3JournalSave(list) { try { localStorage.setItem(T3_JKEY, JSON.stringify(t3JournalTrim(list, Date.now()))); } catch (e) {} }
  function t3Note(e) { var l = t3Journal(); e.at = e.at || Date.now(); e.jid = "j" + e.at + Math.random().toString(36).slice(2, 6); l.push(e); t3JournalSave(l); return e; }
  function t3Unnote(fn) { t3JournalSave(t3Journal().filter(function (e) { return !fn(e); })); }
  function t3Undo(jid) {
    var e = t3Journal().find(function (x) { return x.jid === jid; }); if (!e) return;
    var d = (typeof D === "function") ? D() : null; if (!d) return; var rec = null;
    if (e.kind === "todo") rec = (d.todos || []).find(function (x) { return x && x.id === e.id; });
    else if (e.kind === "customer") rec = (d.customers || []).find(function (x) { return x && x.id === e.id; });
    else if (e.kind === "svc") rec = (d.inventory || []).find(function (x) { return x && x.id === e.id; });
    if (!rec) { t3Unnote(function (x) { return x.jid === jid; }); if (typeof render === "function") render(); return; }
    if (e.kind === "svc" && rec.svc) { rec.svc.log = (rec.svc.log || []).filter(function (l) { return !(l && l.at === e.logAt); }); if (e.undo) { if ("hours" in e.undo) rec.svc.hours = e.undo.hours; if ("hoursAt" in e.undo) rec.svc.hoursAt = e.undo.hoursAt; } }
    else if (e.undo) Object.keys(e.undo).forEach(function (k) { rec[k] = e.undo[k]; });
    rec.updatedAt = Date.now(); if (typeof touch === "function") touch(rec);
    if (typeof logChange === "function") try { logChange("update", e.kind === "svc" ? "inventory" : e.kind, e.id, "Undo: " + (e.label || "")); } catch (_) {}
    t3Unnote(function (x) { return x.jid === jid; });
    if (typeof save === "function") save(); if (typeof render === "function") render();
  }
  window.t3Undo = t3Undo;
  /* the tick on a to-do row */
  if (typeof window.toggleTodo === "function" && !window.toggleTodo._t3) {
    var _tt = window.toggleTodo;
    window.toggleTodo = function (id) { try { var td = ((typeof D === "function" && D().todos) || []).find(function (x) { return x && x.id === id; }); if (td) { if (!td.done) t3Note({ kind: "todo", id: id, label: td.title || "to-do", what: "checked off", undo: { done: false } }); else t3Unnote(function (e) { return e.kind === "todo" && e.id === id; }); } } catch (e) {} return _tt.apply(this, arguments); };
    window.toggleTodo._t3 = 1;
  }
  /* Done ✓ on a service row */
  if (typeof window.svcLog === "function" && !window.svcLog._t3) {
    var _sl = window.svcLog;
    window.svcLog = function (id, key) {
      var i = null, before = 0, h0 = null, ha0 = null; try { i = ((typeof D === "function" && D().inventory) || []).find(function (x) { return x && x.id === id; }); if (i && i.svc) { before = (i.svc.log || []).length; h0 = i.svc.hours; ha0 = i.svc.hoursAt; } } catch (e) {}
      var r = _sl.apply(this, arguments);
      try { if (i && i.svc && (i.svc.log || []).length > before) { var last = i.svc.log[i.svc.log.length - 1]; var p = (i.svc.plan || []).find(function (x) { return x && x.key === key; }); t3Note({ kind: "svc", id: id, key: key, logAt: last.at, label: (p && p.label) || key, what: "marked done", undo: { hours: h0, hoursAt: ha0 } }); } } catch (e) {}
      return r;
    };
    window.svcLog._t3 = 1;
  }
  function t3Apply() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return; if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      var col = document.querySelector("#view .pgcols"); if (!col || col.getAttribute("data-t3")) return;
      var tier = t3Tier(), compact = tier === "compact";
      var blocks = t3Blocks(col);
      var groups = { needs: [], money: [], day: [] };
      blocks.forEach(function (b) { groups[t3Col(b.title)].push(b); });
      col.setAttribute("data-t3", "1");
      var hold = document.createElement("div"); hold.className = "db-hold"; hold.style.display = "none";   // emptied source cards live here, hidden
      /* stats for the strip, read before anything moves */
      var st = { needs: 0, owed: 0, owedN: 0, jobs: 0, clockedIn: false };
      blocks.forEach(function (b) {
        if (/awaiting payment/i.test(b.title) && b.head) { st.processing = t3Money(Array.prototype.slice.call(b.nodes[0] ? b.nodes[0].querySelectorAll(".li") : []).filter(function (li) { return /processing/i.test(li.textContent || ""); }).map(function (li) { var a = li.querySelector("div.nm:last-of-type"); return a ? a.textContent : ""; })); var ct = b.head.querySelector(".ct"); st.owedN = ct ? (parseInt(ct.textContent, 10) || 0) : 0; var vals = []; b.nodes.forEach(function (n) { Array.prototype.slice.call(n.querySelectorAll(".li > .nm, .li > div.nm")).forEach(function (x) { vals.push(x.textContent); }); }); st.owed = t3Money(vals); }
        if (/today's jobs/i.test(b.title)) { var c2 = b.head && b.head.querySelector(".ct"); st.jobs = c2 ? (parseInt(c2.textContent, 10) || 0) : 0; }
        if (/clocked in/i.test(b.title)) { var s = b.nodes[0] && b.nodes[0].querySelector(".sub"); st.clockedIn = (s && /since/i.test(s.textContent)) ? s.textContent.trim() : true; }
      });
      /* NEEDS YOU */
      var rows = t3Inbox(groups.needs); st.needs = rows.length;
      rows = rows.map(function (r, i) { return { r: r, i: i, u: t3Urgency(r.src, r.el.textContent) }; }).sort(function (a, b) { return a.u - b.u || a.i - b.i; }).map(function (x) { return x.r; });
      var inbox = document.createElement("div"); inbox.className = "db-inbox";
      if (!rows.length) { var q = document.createElement("div"); q.className = "db-none"; q.textContent = "Nothing needs you right now."; inbox.appendChild(q); }
      var cap = 6;
      rows.forEach(function (r, i) {
        var el = r.el; el.style.display = ""; el.removeAttribute("data-db-hid");
        el.classList.add("db-row"); if (el.classList.contains("card")) el.classList.add("db-asrow");
        el.setAttribute("data-src", r.src); el.title = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300);
        /* a row with its own checkbox (a to-do) has its mark already */
        if (!el.querySelector(":scope > input[type=checkbox]")) { var mark = document.createElement("span"); mark.className = "db-src"; mark.textContent = r.icon; mark.title = r.src; el.insertBefore(mark, el.firstChild); }
        /* succinct title, small description (Ray, 2026-09-27: "the money side is done correctly") */
        var nm = el.querySelector(".nm"), sub = el.querySelector(".grow > .sub") || el.querySelector(":scope > .sub");
        if (nm) {
          var tn = null; nm.childNodes.forEach(function (c) { if (!tn && c.nodeType === 3 && c.textContent.trim()) tn = c; });
          if (tn) {
            var clean = t3Strip(tn.textContent) + (/\s$/.test(tn.textContent) ? " " : "");
            if (/to-dos/i.test(r.src)) {
              var sp = t3Split(clean, 56); tn.textContent = sp.head;
              if (sp.rest) { if (!sub) { sub = document.createElement("div"); sub.className = "sub"; nm.after(sub); } sub.innerHTML = '<span class="db-rest">' + t3E(sp.rest) + '</span>' + (sub.innerHTML.trim() ? ' · ' + sub.innerHTML : ''); }
            } else tn.textContent = clean;
          }
        }
        if (sub) { var sn = null; sub.childNodes.forEach(function (c) { if (!sn && c.nodeType === 3 && c.textContent.trim()) sn = c; }); if (sn) sn.textContent = t3Strip(sn.textContent); }
        t3Menu(el, r.src);
        inbox.appendChild(el);
      });
      if (rows.length > cap) {
        var more = document.createElement("button"); more.className = "btn ghost sm db-all"; inbox.appendChild(more);
        var paintAll = function () { more.textContent = T3.all ? "Fewer ▴" : "All " + rows.length + " ▾"; rows.forEach(function (r, i) { if (i >= cap) r.el.style.display = T3.all ? "" : "none"; }); };
        more.onclick = function () { T3.all = !T3.all; paintAll(); }; paintAll();
      }
      /* Done today: what left this list today, each with an Undo */
      /* the records are the truth: a to-do completed today, a lead archived today, a service logged today all
         count, whoever ticked them and wherever. Anything not yet in the journal is added so Undo can find it. */
      (function () {
        try {
          var d = (typeof D === "function") ? D() : null; if (!d) return; var jl = t3Journal(), now = Date.now(), added = false;
          var has = function (kind, id, logAt) { return jl.some(function (e) { return e.kind === kind && e.id === id && (logAt == null || e.logAt === logAt); }); };
          (d.todos || []).forEach(function (td) { if (td && td.done && !td.deleted && t3SameDay(td.updatedAt, now) && !has("todo", td.id)) { jl.push({ kind: "todo", id: td.id, label: td.title || "to-do", what: "checked off", at: +td.updatedAt || now, undo: { done: false }, jid: "d" + td.id }); added = true; } });
          (d.customers || []).forEach(function (c) { if (c && c.deleted && c.status === "Lead" && t3SameDay(c.updatedAt, now) && !has("customer", c.id)) { jl.push({ kind: "customer", id: c.id, label: c.name || c.company || "lead", what: "deleted", at: +c.updatedAt || now, undo: { deleted: false }, jid: "d" + c.id }); added = true; } });
          (d.inventory || []).forEach(function (i) { if (!i || !i.svc || !i.svc.log) return; i.svc.log.forEach(function (l) { if (l && t3SameDay(l.at, now) && !has("svc", i.id, l.at)) { var p = (i.svc.plan || []).find(function (x) { return x && x.key === l.key; }); jl.push({ kind: "svc", id: i.id, key: l.key, logAt: l.at, label: (p && p.label) || l.key, what: "marked done", at: +l.at, undo: {}, jid: "d" + i.id + l.at }); added = true; } }); });
          if (added) t3JournalSave(jl.sort(function (a, b) { return (+a.at || 0) - (+b.at || 0); }));
        } catch (e) {}
      })();
      var jn = t3Journal().filter(function (e) { return t3SameDay(e.at, Date.now()); }).reverse();
      {
        var dt = document.createElement("div"); dt.className = "db-donetoday";
        var dh = document.createElement("button"); dh.className = "db-donehd"; dt.appendChild(dh);
        var dl = document.createElement("div"); dl.className = "db-donelist"; dt.appendChild(dl);
        jn.slice(0, 12).forEach(function (e) {
          var row = document.createElement("div"); row.className = "db-donerow";
          var ic = e.kind === "todo" ? "✅" : e.kind === "customer" ? "📞" : "🛠";
          row.innerHTML = '<span class="db-src">' + ic + '</span><div class="grow"><div class="nm">' + t3E(e.label) + '</div><div class="sub">' + t3E(e.what) + ' · ' + t3E(new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + '</div></div>';
          var ub = document.createElement("button"); ub.className = "btn ghost sm"; ub.textContent = "Undo"; ub.onclick = function () { t3Undo(e.jid); }; row.appendChild(ub); dl.appendChild(row);
        });
        var paintDone = function () { var open = !!T3.doneOpen && jn.length > 0; dh.textContent = jn.length ? ((open ? "▾ " : "▸ ") + jn.length + " done today") : "Nothing checked off yet today"; dl.style.display = open ? "" : "none"; dh.disabled = !jn.length; };
        dh.onclick = function () { T3.doneOpen = !T3.doneOpen; paintDone(); }; paintDone();
        inbox.appendChild(dt);
      }
      /* the emptied source cards stay in the DOM, hidden, so nothing that looks for them breaks */
      groups.needs.forEach(function (b) { if (b.quiet) { b.line.style.display = "none"; } if (b.head) b.head.style.display = "none"; b.nodes.forEach(function (n) { if (n.parentNode === col) { n.style.display = "none"; hold.appendChild(n); } }); if (b.line && b.line.parentNode === col) hold.appendChild(b.line); if (b.head && b.head.parentNode === col) hold.appendChild(b.head); });
      /* TILES (Ray, 2026-09-27: "everything should be at a glance unless I want to investigate further…
         a big number with a picture, colored. Click it and it expands into easy-to-read details.")
         Every subject is one tile: icon, one big value, one small label, a tone. Its detail is a pane below
         the tiles that the tile toggles (rule 7); which panes are open is remembered on this device. */
      var tiles = document.createElement("div"); tiles.className = "db-tilegroups";
      var tileGroups = {};
      var tileGroup = function (name) { if (tileGroups[name]) return tileGroups[name]; var w = document.createElement("div"); w.className = "db-tilegroup"; var hd = document.createElement("div"); hd.className = "secthd db-colhd"; hd.innerHTML = "<h2>" + t3E(name) + "</h2>"; var g = document.createElement("div"); g.className = "db-tiles"; w.appendChild(hd); w.appendChild(g); tiles.appendChild(w); tileGroups[name] = g; return g; };
      var detail = document.createElement("div"); detail.className = "db-detail";
      var TILE_KEY = "jra_t3_tiles"; var openSet = {}; try { openSet = JSON.parse(localStorage.getItem(TILE_KEY) || "{}") || {}; } catch (e) {}
      var saveOpen = function () { try { localStorage.setItem(TILE_KEY, JSON.stringify(openSet)); } catch (e) {} };
      var claimed = [];
      var addTile = function (o) {
        var pane = document.createElement("section"); pane.className = "card db-pane"; pane.setAttribute("data-pane", o.key);
        var ph = document.createElement("div"); ph.className = "row db-panehd"; ph.innerHTML = '<div class="nm">' + t3E(o.title) + '</div><span class="db-paneend"></span>'; pane.appendChild(ph);
        var body = document.createElement("div"); body.className = "db-panebody"; pane.appendChild(body);
        (o.nodes || []).forEach(function (n) { body.appendChild(n); n.style.display = ""; });
        (o.blocks || []).forEach(function (b, bi) {
          claimed.push(b);
          if (b.head) b.head.classList.add("db-sub");
          /* one block whose head repeats the pane title: its buttons and count move up, the head goes */
          if (b.head && (o.blocks || []).length === 1) { Array.prototype.slice.call(b.head.querySelectorAll("button, .ct")).forEach(function (x) { x.style.marginLeft = ""; ph.insertBefore(x, ph.lastElementChild); }); b.head.classList.add("db-hide"); }
          b.nodes.forEach(function (n) { if (n.classList.contains("card")) n.classList.add("db-flat"); });
          t3Move(body, b);
          if (b.line) { b.line.style.display = "none"; if (b.head) b.head.style.display = ""; b.nodes.forEach(function (n) { n.style.display = ""; }); }
        });
        var tile = document.createElement("button"); tile.className = "db-tile tone-" + (o.tone || "plain"); tile.setAttribute("data-tile", o.key);
        tile.innerHTML = '<span class="ic">' + o.icon + '</span><span class="val">' + t3E(o.value) + '</span><span class="lbl">' + t3E(o.label) + '</span>';
        var paint = function () { var open = !!openSet[o.key]; tile.classList.toggle("on", open); pane.style.display = open ? "" : "none"; };
        var toggle = function () { openSet[o.key] = !openSet[o.key]; saveOpen(); paint(); if (openSet[o.key]) { pane.scrollIntoView({ block: "nearest", behavior: "smooth" }); if (o.onOpen) o.onOpen(); } };
        tile.onclick = function () { if (T3.arrange) return; toggle(); }; paint();   // the tile is the switch both ways (Ray: "Hide is useless, you just click the card again")
        tile.setAttribute("data-group", o.group || "Today");
        tileGroup(o.group || "Today").appendChild(tile); detail.appendChild(pane);
      };
      var take = function (re, from) { return from.filter(function (b) { return re.test(b.title); }); };
      groups.money.forEach(function (b) { if (/awaiting payment|not expecting/i.test(b.title)) b.nodes.forEach(function (n) { n.querySelectorAll(".li").forEach(function (li) { li.style.position = "relative"; t3Menu(li, b.title); }); }); });
      var moneyOf = function (bs) { var v = []; bs.forEach(function (b) { b.nodes.forEach(function (n) { n.querySelectorAll(".li > .nm, .li > div.nm").forEach(function (x) { v.push(x.textContent); }); }); }); return t3Money(v); };
      /* 1. needs you */
      addTile({ key: "needs", icon: "🔔", value: String(rows.length), label: rows.length === 1 ? "needs you" : "need you", tone: rows.length ? "danger" : "plain", title: "Needs you", nodes: [inbox] });
      /* 2. money */
      var owedB = take(/awaiting payment|invoices to send|not expecting/i, groups.money);
      var ms = window.MT_STATS || null;
      var cashB = take(/cash on hand/i, groups.money);
      if (cashB.length && ms) addTile({ group: "Money", key: "cash", icon: "🏦", value: t3Fmt(Math.round(ms.cashCents / 100)), label: ms.accounts ? ("cash on hand · " + ms.accounts + (ms.accounts === 1 ? " account" : " accounts")) : "pick the accounts", tone: ms.accounts ? "ok" : "plain", title: "Cash on hand", blocks: cashB });
      if (owedB.length) addTile({ group: "Money", key: "owed", icon: "💵", value: t3Fmt(st.owed), label: "invoiced · " + st.owedN + (st.owedN === 1 ? " invoice" : " invoices") + (st.processing ? " · " + t3Fmt(st.processing) + " processing" : ""), tone: "accent", title: "Invoiced", blocks: owedB });
      /* next 30 days: what the scheduled jobs are quoted at (Ray: "what our cash flow looks like") */
      var upB = take(/next 30 days/i, groups.money);
      /* LEADS (Ray, 2026-09-27): clicks yesterday, expected value over the next 30 days, ad spend this month */
      var clB = take(/clicks yesterday/i, groups.money), spB = take(/ad spend/i, groups.money);
      if (clB.length) addTile({ group: "Leads", key: "clicks", icon: "🖱", value: "…", label: "clicks yesterday", tone: "plain", title: "Clicks yesterday", blocks: clB });
      if (upB.length) { var upAmt = moneyOf(upB), upN = 0; upB.forEach(function (b) { var ct = b.head && b.head.querySelector(".ct"); upN += ct ? (parseInt(ct.textContent, 10) || 0) : 0; }); addTile({ group: "Leads", key: "upcoming", icon: "📆", value: t3Fmt(upAmt), label: "next 30 days · " + upN + (upN === 1 ? " job" : " jobs"), tone: "brand", title: "Next 30 days", blocks: upB }); }
      /* "Not expecting" (js/50 recDoubtful) rides in the Owed pane, folded, and never in the tile's number */
      (function () {
        var pane = detail.querySelector('[data-pane="owed"] .db-panebody'); if (!pane) return;
        var hd = Array.prototype.slice.call(pane.querySelectorAll(".secthd.db-sub")).find(function (h) { return /not expecting/i.test(h.textContent || ""); }); if (!hd) return;
        var card = hd.nextElementSibling; if (!card) return;
        var wrap = document.createElement("div"); wrap.className = "db-nexp"; hd.before(wrap);
        var tb = document.createElement("button"); tb.className = "db-donehd"; wrap.appendChild(tb); wrap.appendChild(hd); wrap.appendChild(card);
        var amt = t3Money(Array.prototype.slice.call(card.querySelectorAll(".li > div.nm:last-of-type")).map(function (x) { return x.textContent; })), n = card.querySelectorAll(".li").length;
        hd.classList.add("db-hide");
        var paintN = function () { var open = !!T3.nexp; tb.textContent = (open ? "▾ " : "▸ ") + "Not expecting " + t3Fmt(amt) + " · " + n + (n === 1 ? " invoice" : " invoices"); card.style.display = open ? "" : "none"; };
        tb.onclick = function () { T3.nexp = !T3.nexp; paintN(); }; paintN();
      })();
      if (spB.length) addTile({ group: "Leads", key: "spend", icon: "💸", value: "…", label: "ads this month", tone: "plain", title: "Ad spend this month", blocks: spB });
      if (typeof adsPaint === "function") setTimeout(adsPaint, 0);
      var pipeB = take(/confirmed jobs|open quotes/i, groups.money);
      if (pipeB.length) addTile({ group: "Money", key: "pipe", icon: "🧾", value: t3Fmt(moneyOf(pipeB)), label: "booked and quoted", tone: "brand", title: "In the pipeline", blocks: pipeB });
      var payB = take(/payouts/i, groups.money);
      if (payB.length) {
        var me = (typeof curUser === "function") ? curUser() : null, mine = "", when = "";
        payB.forEach(function (b) { b.nodes.forEach(function (n) { var wb = n.querySelector(".sub b"); if (wb) when = wb.textContent.trim(); n.querySelectorAll(".li").forEach(function (li) { var nms = li.querySelectorAll(".nm"); if (nms.length >= 2 && me && nms[0].textContent.trim() === (me.username || "")) mine = nms[nms.length - 1].textContent.trim(); }); }); });
        if (!mine) { var f = payB[0].nodes[0] && payB[0].nodes[0].querySelector(".li"); var fn = f ? f.querySelectorAll(".nm") : []; mine = fn.length ? fn[fn.length - 1].textContent.trim() : "$0"; }
        addTile({ group: "Money", key: "pay", icon: "💰", value: mine, label: "owed to me · all time", tone: "accent", title: "Payouts · all time", blocks: payB });
      }
      var fixB = take(/fixed costs/i, groups.money);
      if (fixB.length && ms) addTile({ group: "Money", key: "fixed", icon: "🔁", value: t3Fmt(Math.round(ms.fixedCents / 100)), label: "fixed costs this month", tone: "plain", title: "Fixed costs this month", blocks: fixB });
      var leftB = take(/left after/i, groups.money);
      if (leftB.length && ms) addTile({ group: "Money", key: "left", icon: "⚖️", value: (ms.deltaCents < 0 ? "−" : "") + t3Fmt(Math.round(Math.abs(ms.deltaCents) / 100)), label: "left after costs and crew", tone: ms.deltaCents < 0 ? "danger" : "ok", title: "Left after obligations", blocks: leftB });
      /* 3. the day */
      var jobsB = take(/today's jobs/i, groups.day);
      if (jobsB.length) addTile({ key: "jobs", icon: "📅", value: String(st.jobs), label: st.jobs === 1 ? "job today" : "jobs today", tone: st.jobs ? "brand" : "plain", title: "Today's jobs", blocks: jobsB });
      var crewB = take(/who's working/i, groups.day);
      if (crewB.length) {
        var labels = []; crewB.forEach(function (b) { b.nodes.forEach(function (n) { n.querySelectorAll(".li > span").forEach(function (x) { labels.push(x.textContent); }); }); });
        var w = t3Working(labels); addTile({ key: "crew", icon: "👥", value: String(w), label: "working today", tone: w ? "brand" : "plain", title: "Who's working today", blocks: crewB });
      }
      var clockB = take(/clock in|clocked in/i, groups.day).filter(function (b) { return !/who's/i.test(b.title); });
      if (clockB.length) { var live = /clocked in/i.test(clockB[0].title); addTile({ key: "clock", icon: "⏱", value: live ? "On" : "Clock in", label: live ? (st.clockedIn === true ? "the clock" : String(st.clockedIn)) : "tap to start", tone: live ? "ok" : "act", title: live ? "Clocked in" : "Clock in", blocks: clockB, onOpen: function () { var fld = detail.querySelector('[data-pane="clock"] select, [data-pane="clock"] input'); if (fld) fld.focus(); } }); }
      /* STAND-UP = THE DAILY HARNESS (Ray, 2026-09-27: "Cap and stand-up are essentially the same thing. Make a
         harness for stand-up that gets examined and filled out every day with questions, concerns and important
         info"). One tile, one sheet: the day's brief (Cap's last message) on top, what is due, the questions
         waiting for an answer, Ray's own line, and Cap's input at the bottom for anything else. */
      var suB = take(/stand-up/i, groups.day), capB = take(/^cap\b|🧭 cap|^🧭 cap/i, groups.day);
      if (suB.length || capB.length) {
        var suTxt = suB.map(function (b) { return b.nodes.map(function (n) { return n.textContent; }).join(" "); }).join(" ");
        var qN = 0; suB.forEach(function (b) { b.nodes.forEach(function (n) { qN += n.querySelectorAll("input[id^='su_q_']").length; }); });
        var overdueN = (suTxt.match(/overdue/gi) || []).length;
        var written = false; suB.forEach(function (b) { b.nodes.forEach(function (n) { var p = n.querySelector("#su_plan"); if (p && (p.value || "").trim()) written = true; }); });
        var val = qN ? String(qN) : (written ? "✓" : "9:00"), lbl = qN ? (qN === 1 ? "question for you" : "questions for you") : (written ? "stand-up written" : "stand-up · not written") + (overdueN ? " · " + overdueN + " overdue" : "");
        addTile({ key: "standup", icon: "🧭", value: val, label: lbl, tone: qN ? "danger" : (written ? "ok" : (overdueN ? "danger" : "plain")), title: "Stand-up", blocks: suB.concat(capB), onOpen: function () { var q = detail.querySelector('[data-pane="standup"] input[id^="su_q_"]'); if (q) q.focus(); } });
        /* inside the pane: the brief first, Cap's chat folded, its input kept */
        (function () {
          var body = detail.querySelector('[data-pane="standup"] .db-panebody'); if (!body) return;
          var th = body.querySelector("#cap-thread"), capCard = th && th.closest(".card"), capHd = capCard && capCard.previousElementSibling;
          if (capHd && capHd.classList.contains("secthd")) capHd.classList.add("db-hide");
          if (th) {
            /* the thread is folded (display:none), so innerText gives no line breaks: read the <br>s ourselves */
            var last = th.lastElementChild, raw = last ? String(last.innerHTML || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ") : "";
            var paras = raw.replace(/\*\*/g, "").split(/\n\s*\n|\n/).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean);
            if (paras.length) { var brief = document.createElement("div"); brief.className = "db-brief"; brief.innerHTML = '<div class="nm">Today\'s brief</div>' + paras.map(function (x) { return '<div class="sub">' + t3E(x) + '</div>'; }).join(""); body.insertBefore(brief, body.firstChild); }
            /* the stand-up card's own title repeats the pane's */
            var suNm = body.querySelector(".db-panebody > .card .nm"); if (suNm && /stand-up/i.test(suNm.textContent || "")) suNm.classList.add("db-hide");
            th.classList.add("db-capthread"); if (!T3.cap) th.classList.add("db-fold");
            var cb = document.createElement("button"); cb.className = "btn ghost sm db-capgo"; capCard.insertBefore(cb, th);
            t3Toggle(cb, th, "db-fold", "Earlier with Cap ▾", "Hide ▴", "cap", function (open) { if (open && typeof capScrollThread === "function") setTimeout(capScrollThread, 20); });
            var ci = capCard.querySelector("#cap-input"); if (ci) ci.placeholder = "Ask Cap, or note a concern for the stand-up…";
          }
        })();
      }
      var adsB = take(/ads|off duty/i, groups.day);
      if (adsB.length) {
        var adsTxt = adsB[0].nodes.map(function (n) { return n.textContent; }).join(" ");
        var adsOn = /running/i.test(adsTxt) ? true : /paused/i.test(adsTxt) ? false : null;   // null = still checking (js/182 fetches after render)
        addTile({ key: "ads", icon: "📣", value: adsOn === null ? "…" : adsOn ? "On" : "Off", label: "Google Ads", tone: adsOn ? "ok" : "plain", title: "Ads", blocks: adsB });
        if (!window.__t3DutyHook) { window.__t3DutyHook = true; window.addEventListener("duty-updated", function (ev) {
          var t = document.querySelector('.db-tile[data-tile="ads"]'); if (!t) return; var on = ev.detail && ev.detail.on;
          var v = t.querySelector(".val"); if (v) v.textContent = on === null || on === undefined ? (ev.detail && ev.detail.err ? "—" : "…") : on ? "On" : "Off";
          t.classList.toggle("tone-ok", on === true); t.classList.toggle("tone-plain", on !== true);
        }); } }
      /* anything not claimed keeps a home */
      var rest = groups.money.concat(groups.day).filter(function (b) { return claimed.indexOf(b) < 0; });
      if (rest.length) addTile({ key: "more", icon: "•••", value: String(rest.length), label: "more", tone: "plain", title: "More", blocks: rest });
      /* the stand-up's record folds until there is something to say; the agenda folds under More */
      var su = detail.querySelector("#su_plan");
      if (su) {
        var rec = su.parentNode, sc = rec.parentNode, blk = document.getElementById("su_block");
        var plan = (su.value || "").trim(), blockers = (blk && (blk.value || "").trim()) || "", has = !!(plan || blockers);
        rec.classList.add("db-surec");
        var kids = Array.prototype.slice.call(sc.children), foldSet = [];
        kids.forEach(function (k, i) {
          if (i === 0 || k === rec || k.classList.contains("db-more") || k.classList.contains("db-surec")) return;
          var txt = (k.textContent || "").trim();
          if (/^due:/i.test(txt) || /questions for you/i.test(txt) || k.querySelector(".li[style]") && /⚠|plan/.test(txt) && k.querySelector(".nm")) return;
          if (/^no open questions/i.test(txt)) { k.classList.add("db-hide"); return; }
          if (k.querySelector("#su_plan")) return;
          foldSet.push(k);
        });
        var acts = document.createElement("div"); acts.className = "row db-suacts"; rec.before(acts);
        if (has) { var sum = document.createElement("div"); sum.className = "sub db-susum"; sum.textContent = "You: " + plan + (blockers ? " · ⚠ " + blockers : ""); acts.before(sum); }
        var wbtn = document.createElement("button"); wbtn.className = "btn ghost sm db-suopen"; acts.appendChild(wbtn);
        if (!T3.standup) rec.classList.add("db-fold");
        t3Toggle(wbtn, rec, "db-fold", has ? "✎ Edit my stand-up ▾" : "✎ Write my stand-up ▾", "Hide ▴", "standup", function (open) { var s2 = sc.querySelector(".db-susum"); if (s2) s2.style.display = open ? "none" : ""; if (open) su.focus(); });
        if (foldSet.length) {
          var wrap = document.createElement("div"); wrap.className = "db-sufold"; if (!T3.suMore) wrap.classList.add("db-fold");
          rec.after(wrap); foldSet.forEach(function (k) { wrap.appendChild(k); });
          var mb = document.createElement("button"); mb.className = "btn ghost sm db-sumore"; acts.appendChild(mb);
          t3Toggle(mb, wrap, "db-fold", "More ▾", "Less ▴", "suMore");
        }
      }
      /* what is elsewhere is not here */
      var vt = detail.querySelector("#cap-voice-toggle"); if (vt && vt.parentNode) vt.parentNode.classList.add("db-voice");
      var duty = detail.querySelector("#duty_card");
      if (duty) Array.prototype.slice.call(duty.querySelectorAll(".sub")).forEach(function (pp) { if (/business profile/i.test(pp.textContent || "")) { pp.classList.add("db-hide"); duty.title = (pp.textContent || "").trim(); } });
      Array.prototype.slice.call(detail.querySelectorAll("button")).forEach(function (bt) { if (/snap a receipt/i.test(bt.textContent || "")) bt.classList.add("db-snap"); });
      /* ARRANGE: saved order per group, then right-click / long-press to rearrange */
      var ORD_KEY = "jra_t3_order_" + ((typeof S !== "undefined" && S.biz) || "");
      var ordSaved = {}; try { ordSaved = JSON.parse(localStorage.getItem(ORD_KEY) || "{}") || {}; } catch (e) {}
      var ordSave = function () { try { localStorage.setItem(ORD_KEY, JSON.stringify(ordSaved)); } catch (e) {} };
      var groupKeys = function (g) { return Array.prototype.slice.call(g.querySelectorAll(".db-tile")).map(function (x) { return x.getAttribute("data-tile"); }); };
      var applyOrder = function (name) {
        var g = tileGroups[name]; if (!g) return;
        var order = t3Order(groupKeys(g), ordSaved[name]);
        order.forEach(function (k) { var el = g.querySelector('.db-tile[data-tile="' + k + '"]'); if (el) g.appendChild(el); });
        ordSaved[name] = order;
      };
      Object.keys(tileGroups).forEach(applyOrder);
      var paintArrange = function () {
        tiles.classList.toggle("arranging", !!T3.arrange);
        Object.keys(tileGroups).forEach(function (name) {
          var g = tileGroups[name], hd = g.previousElementSibling;
          var done = hd.querySelector(".db-arrdone");
          if (T3.arrange && !done) { done = document.createElement("button"); done.className = "btn acc sm db-arrdone"; done.textContent = "✓ Done"; done.style.marginLeft = "auto"; done.onclick = function () { T3.arrange = false; paintArrange(); }; hd.appendChild(done); }
          if (!T3.arrange && done) done.remove();
          Array.prototype.slice.call(g.querySelectorAll(".db-tile")).forEach(function (tile, i, all) {
            var bar = tile.querySelector(".db-arr");
            if (T3.arrange && !bar) {
              bar = document.createElement("span"); bar.className = "db-arr";
              var mk = function (dir, txt) { var b = document.createElement("button"); b.textContent = txt; b.disabled = (dir < 0 && i === 0) || (dir > 0 && i === all.length - 1); b.onclick = function (e) { e.stopPropagation(); ordSaved[name] = t3MoveKey(groupKeys(g), tile.getAttribute("data-tile"), dir); applyOrder(name); ordSave(); paintArrange(); }; return b; };
              bar.appendChild(mk(-1, "◀")); bar.appendChild(mk(1, "▶")); tile.appendChild(bar);
              tile.setAttribute("draggable", "true");
            }
            if (!T3.arrange && bar) { bar.remove(); tile.removeAttribute("draggable"); }
            tile.classList.toggle("arr", !!T3.arrange);
          });
        });
      };
      var arrangeOn = function () { T3.arrange = true; paintArrange(); };
      Object.keys(tileGroups).forEach(function (name) {
        var g = tileGroups[name];
        g.addEventListener("contextmenu", function (e) { if (e.target.closest(".db-tile")) { e.preventDefault(); arrangeOn(); } });
        var pressT = null;
        g.addEventListener("touchstart", function (e) { var t = e.target.closest(".db-tile"); if (!t) return; pressT = setTimeout(function () { pressT = null; arrangeOn(); try { navigator.vibrate && navigator.vibrate(20); } catch (_) {} }, 550); }, { passive: true });
        ["touchend", "touchmove", "touchcancel"].forEach(function (ev) { g.addEventListener(ev, function () { if (pressT) { clearTimeout(pressT); pressT = null; } }, { passive: true }); });
        /* drag (desktop, in arrange mode) */
        var dragKey = null;
        g.addEventListener("dragstart", function (e) { var t = e.target.closest(".db-tile"); if (!t || !T3.arrange) { e.preventDefault(); return; } dragKey = t.getAttribute("data-tile"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragKey); } catch (_) {} });
        g.addEventListener("dragover", function (e) { if (!dragKey) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
        g.addEventListener("drop", function (e) {
          if (!dragKey) return; e.preventDefault(); var over = e.target.closest(".db-tile"); if (!over || over.getAttribute("data-tile") === dragKey) { dragKey = null; return; }
          var keys = groupKeys(g).filter(function (k) { return k !== dragKey; }); var at = keys.indexOf(over.getAttribute("data-tile"));
          var rect = over.getBoundingClientRect(); if (e.clientX > rect.left + rect.width / 2) at++;
          keys.splice(at, 0, dragKey); ordSaved[name] = keys; applyOrder(name); ordSave(); paintArrange(); dragKey = null;
        });
      });
      paintArrange();
      /* the date, then the tiles, then whatever is open */
      var hero = document.createElement("div"); hero.className = "db-hero";
      var d = new Date(); hero.innerHTML = '<div class="db-date">' + t3E(d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })) + '</div>';
      col.appendChild(hero); col.appendChild(tiles); col.appendChild(detail); col.appendChild(hold);
    } catch (e) { try { console.warn("today pass skipped:", e); } catch (_) {} }
  }
  if (typeof secSplit === "function") { var _ss9 = secSplit; secSplit = function (tab) { var r = _ss9.apply(this, arguments); t3Apply(); return r; }; window.secSplit = secSplit; }
  window.t3Col = t3Col; window.t3Order = t3Order; window.t3MoveKey = t3MoveKey; window.t3SameDay = t3SameDay; window.t3JournalTrim = t3JournalTrim; window.t3Urgency = t3Urgency; window.t3Actions = t3Actions; window.t3Shift = t3Shift; window.t3Split = t3Split; window.t3Strip = t3Strip; window.t3Working = t3Working; window.t3Icon = t3Icon; window.t3Money = t3Money; window.t3Chips = t3Chips;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { t3Col: t3Col, t3Order: t3Order, t3MoveKey: t3MoveKey, t3SameDay: t3SameDay, t3JournalTrim: t3JournalTrim, t3Actions: t3Actions, t3Shift: t3Shift, t3Split: t3Split, t3Strip: t3Strip, t3Working: t3Working, t3MoneyRank: t3MoneyRank, t3Urgency: t3Urgency, t3Icon: t3Icon, t3Money: t3Money, t3Fmt: t3Fmt, t3Chips: t3Chips }; }
