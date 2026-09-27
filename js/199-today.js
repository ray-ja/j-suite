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
var T3_MONEY = /awaiting payment|open quotes|payouts|invoices to send|confirmed jobs/i;
/* the money panel reads top-down from what is owed to what is paid out. Pure. */
var T3_MONEY_ORDER = [/awaiting payment/i, /invoices to send/i, /confirmed jobs/i, /open quotes/i, /payouts/i];
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
/* the header strip's chips from the counts. stats = {needs, owed, owedN, jobs, clockedIn}. Pure. */
function t3Chips(st) {
  st = st || {}; var out = [];
  out.push({ key: "needs", text: st.needs > 0 ? (st.needs + " need" + (st.needs === 1 ? "s" : "") + " you") : "Nothing needs you", hot: st.needs > 0 });
  if (st.owedN > 0) out.push({ key: "money", text: t3Fmt(st.owed) + " owed · " + st.owedN + " invoice" + (st.owedN === 1 ? "" : "s"), hot: false });
  if (st.clockedIn) out.push({ key: "day", text: "Clocked in" + (st.clockedIn === true ? "" : " · " + st.clockedIn), hot: false });
  else out.push({ key: "day", text: st.jobs > 0 ? (st.jobs + " job" + (st.jobs === 1 ? "" : "s") + " today") : "No jobs today", hot: false });
  return out;
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
      if (!cur || (k.classList.contains("card") && !cur.quiet && cur.nodes.some(function (n) { return n.classList.contains("card"); }))) { cur = { head: null, nodes: [], title: "" }; out.push(cur); }
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
  function t3Apply() {
    try {
      if (typeof TAB === "undefined" || TAB !== "today") return; if (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) return;
      var col = document.querySelector("#view .pgcols"); if (!col || col.getAttribute("data-t3")) return;
      var tier = t3Tier(), compact = tier === "compact";
      var blocks = t3Blocks(col);
      var groups = { needs: [], money: [], day: [] };
      blocks.forEach(function (b) { groups[t3Col(b.title)].push(b); });
      col.setAttribute("data-t3", "1");
      var cols = {};
      ["needs", "money", "day"].forEach(function (k) { var d = document.createElement("div"); d.className = "db-col " + k; d.setAttribute("data-col", k); cols[k] = d; });
      /* stats for the strip, read before anything moves */
      var st = { needs: 0, owed: 0, owedN: 0, jobs: 0, clockedIn: false };
      blocks.forEach(function (b) {
        if (/awaiting payment/i.test(b.title) && b.head) { var ct = b.head.querySelector(".ct"); st.owedN = ct ? (parseInt(ct.textContent, 10) || 0) : 0; var vals = []; b.nodes.forEach(function (n) { Array.prototype.slice.call(n.querySelectorAll(".li > .nm, .li > div.nm")).forEach(function (x) { vals.push(x.textContent); }); }); st.owed = t3Money(vals); }
        if (/today's jobs/i.test(b.title)) { var c2 = b.head && b.head.querySelector(".ct"); st.jobs = c2 ? (parseInt(c2.textContent, 10) || 0) : 0; }
        if (/clocked in/i.test(b.title)) { var s = b.nodes[0] && b.nodes[0].querySelector(".sub"); st.clockedIn = (s && /since/i.test(s.textContent)) ? s.textContent.trim() : true; }
      });
      /* NEEDS YOU */
      var rows = t3Inbox(groups.needs); st.needs = rows.length;
      rows = rows.map(function (r, i) { return { r: r, i: i, u: t3Urgency(r.src, r.el.textContent) }; }).sort(function (a, b) { return a.u - b.u || a.i - b.i; }).map(function (x) { return x.r; });
      cols.needs.appendChild(t3Head("Needs you", rows.length || null));
      var inbox = document.createElement("div"); inbox.className = "card db-inbox"; cols.needs.appendChild(inbox);
      if (!rows.length) { var q = document.createElement("div"); q.className = "db-none"; q.textContent = "Nothing needs you right now."; inbox.appendChild(q); }
      var cap = 6;
      rows.forEach(function (r, i) {
        var el = r.el; el.style.display = ""; el.removeAttribute("data-db-hid");
        el.classList.add("db-row"); if (el.classList.contains("card")) el.classList.add("db-asrow");
        el.setAttribute("data-src", r.src); el.title = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300);
        /* a row with its own checkbox (a to-do) has its mark already */
        if (!el.querySelector(":scope > input[type=checkbox]")) { var mark = document.createElement("span"); mark.className = "db-src"; mark.textContent = r.icon; mark.title = r.src; el.insertBefore(mark, el.firstChild); }
        inbox.appendChild(el);
      });
      if (rows.length > cap) {
        var more = document.createElement("button"); more.className = "btn ghost sm db-all"; inbox.appendChild(more);
        var paintAll = function () { more.textContent = T3.all ? "Fewer ▴" : "All " + rows.length + " ▾"; rows.forEach(function (r, i) { if (i >= cap) r.el.style.display = T3.all ? "" : "none"; }); };
        more.onclick = function () { T3.all = !T3.all; paintAll(); }; paintAll();
      }
      /* the emptied source cards stay in the DOM, hidden, so nothing that looks for them breaks */
      groups.needs.forEach(function (b) { if (b.quiet) { b.line.style.display = "none"; } if (b.head) b.head.style.display = "none"; b.nodes.forEach(function (n) { if (n.parentNode === col) { n.style.display = "none"; cols.needs.appendChild(n); } }); if (b.line && b.line.parentNode === col) cols.needs.appendChild(b.line); if (b.head && b.head.parentNode === col) cols.needs.appendChild(b.head); });
      /* MONEY */
      if (groups.money.length) {
        cols.money.appendChild(t3Head("Money"));
        groups.money.sort(function (a, b) { return t3MoneyRank(a.title) - t3MoneyRank(b.title); });
        var panel = document.createElement("div"); panel.className = "card db-panel"; cols.money.appendChild(panel);
        groups.money.forEach(function (b) {
          if (b.head) b.head.classList.add("db-sub");
          b.nodes.forEach(function (n) { if (n.classList.contains("card")) n.classList.add("db-flat"); });
          t3Move(panel, b);
        });
      }
      /* THE DAY */
      cols.day.appendChild(t3Head("The day"));
      groups.day.forEach(function (b) { t3Move(cols.day, b); });
      /* rule 4: clock in folds (desktop) */
      Array.prototype.slice.call(cols.day.querySelectorAll(".card")).forEach(function (card) {
        var nm = card.firstElementChild; if (!nm || !nm.classList.contains("nm") || !/clock in/i.test(nm.textContent || "") || !card.querySelector("select")) return;
        card.classList.add("db-clockcard"); if (compact) return;
        var hd = document.createElement("div"); hd.className = "row db-clockhd"; card.insertBefore(hd, nm); hd.appendChild(nm);
        var btn = document.createElement("button"); btn.className = "btn sm db-clockgo"; hd.appendChild(btn);
        if (!T3.clock) card.classList.add("folded");
        t3Toggle(btn, card, "folded", "Clock in…", "Hide ▴", "clock", function (open) { if (open) { var f = card.querySelector("select,input"); if (f) f.focus(); } });
      });
      /* rule 4: the stand-up's record folds until there is something to say */
      var su = cols.day.querySelector("#su_plan");
      if (su) {
        var rec = su.parentNode, sc = rec.parentNode, blk = document.getElementById("su_block");
        var plan = (su.value || "").trim(), blockers = (blk && (blk.value || "").trim()) || "", has = !!(plan || blockers);
        rec.classList.add("db-surec");
        /* what stays: the head, the Due line, questions for you, other people's notes. The rest folds. */
        var kids = Array.prototype.slice.call(sc.children), foldSet = [];
        kids.forEach(function (k, i) {
          if (i === 0 || k === rec || k.classList.contains("db-more") || k.classList.contains("db-surec")) return;
          var txt = (k.textContent || "").trim();
          if (/^due:/i.test(txt) || /questions for you/i.test(txt) || k.querySelector(".li[style]") && /⚠|plan/.test(txt) && k.querySelector(".nm")) return;
          if (/^no open questions/i.test(txt)) { k.classList.add("db-hide"); return; }
          if (k.querySelector("#su_plan")) return;
          foldSet.push(k);
        });
        /* one row of actions above my record; the folded agenda sits below it */
        var acts = document.createElement("div"); acts.className = "row db-suacts"; rec.before(acts);
        if (has) { var sum = document.createElement("div"); sum.className = "sub db-susum"; sum.textContent = "You: " + plan + (blockers ? " · ⚠ " + blockers : ""); acts.before(sum); }
        var w = document.createElement("button"); w.className = "btn ghost sm db-suopen"; acts.appendChild(w);
        if (!T3.standup) rec.classList.add("db-fold");
        t3Toggle(w, rec, "db-fold", has ? "✎ Edit my stand-up ▾" : "✎ Write my stand-up ▾", "Hide ▴", "standup", function (open) { var s2 = sc.querySelector(".db-susum"); if (s2) s2.style.display = open ? "none" : ""; if (open) su.focus(); });
        if (foldSet.length) {
          var wrap = document.createElement("div"); wrap.className = "db-sufold"; if (!T3.suMore) wrap.classList.add("db-fold");
          rec.after(wrap); foldSet.forEach(function (k) { wrap.appendChild(k); });
          var mb = document.createElement("button"); mb.className = "btn ghost sm db-sumore"; acts.appendChild(mb);
          t3Toggle(mb, wrap, "db-fold", "More ▾", "Less ▴", "suMore");
        }
      }
      /* rule 6: what is elsewhere is not here */
      var vt = cols.day.querySelector("#cap-voice-toggle"); if (vt && vt.parentNode) vt.parentNode.classList.add("db-voice");
      var th = cols.day.querySelector("#cap-thread");
      if (th) {
        th.classList.add("db-capthread");
        var capCard = th.closest(".card"), capHd = capCard && capCard.previousElementSibling;
        var lastMsg = th.lastElementChild;
        if (capCard && lastMsg && !compact) {
          var lastLine = document.createElement("div"); lastLine.className = "db-caplast db-clamp"; lastLine.textContent = (lastMsg.textContent || "").replace(/\s+/g, " ").trim(); th.after(lastLine);
          if (!T3.cap) th.classList.add("db-fold");
          var cb = document.createElement("button"); cb.className = "btn ghost sm db-capgo";
          if (capHd && capHd.classList.contains("secthd")) capHd.appendChild(cb); else capCard.insertBefore(cb, capCard.firstChild);
          var paintCap = function (open) { lastLine.style.display = open ? "none" : ""; if (open && typeof capScrollThread === "function") setTimeout(capScrollThread, 20); };
          t3Toggle(cb, th, "db-fold", "Chat ▾", "Hide ▴", "cap", paintCap); paintCap(!!T3.cap);
          var ci = capCard.querySelector("#cap-input"); if (ci) ci.addEventListener("focus", function () { if (!T3.cap) cb.click(); });
        }
      }
      var duty = cols.day.querySelector("#duty_card");
      if (duty) Array.prototype.slice.call(duty.querySelectorAll(".sub")).forEach(function (p) { if (/business profile/i.test(p.textContent || "")) { p.classList.add("db-hide"); duty.title = (p.textContent || "").trim(); } });
      Array.prototype.slice.call(cols.day.querySelectorAll("button")).forEach(function (b) { if (/snap a receipt/i.test(b.textContent || "")) b.classList.add("db-snap"); });
      /* rule 1: the strip */
      var hero = document.createElement("div"); hero.className = "db-hero";
      var d = new Date(); var date = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      hero.innerHTML = '<div class="db-date">' + t3E(date) + '</div><div class="db-chips">' + t3Chips(st).map(function (c) { return '<button class="db-chip' + (c.hot ? " hot" : "") + '" data-go="' + c.key + '">' + t3E(c.text) + '</button>'; }).join("") + '</div>';
      hero.querySelectorAll(".db-chip").forEach(function (c) { c.onclick = function () { var t = cols[c.getAttribute("data-go")]; if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }; });
      col.appendChild(hero); col.appendChild(cols.needs); col.appendChild(cols.money); col.appendChild(cols.day);
      if (!groups.money.length) cols.money.classList.add("db-empty");
    } catch (e) { try { console.warn("today pass skipped:", e); } catch (_) {} }
  }
  if (typeof secSplit === "function") { var _ss9 = secSplit; secSplit = function (tab) { var r = _ss9.apply(this, arguments); t3Apply(); return r; }; window.secSplit = secSplit; }
  window.t3Col = t3Col; window.t3Urgency = t3Urgency; window.t3Icon = t3Icon; window.t3Money = t3Money; window.t3Chips = t3Chips;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { t3Col: t3Col, t3MoneyRank: t3MoneyRank, t3Urgency: t3Urgency, t3Icon: t3Icon, t3Money: t3Money, t3Fmt: t3Fmt, t3Chips: t3Chips }; }
