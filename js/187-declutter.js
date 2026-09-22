/* ---------- DECLUTTER (js/187) — lists open on the rows ----------
   Ray, 2026-09-22, UX audit, Phase 2: on a phone the Jobs screen showed two wizard buttons, a search box,
   seven status chips, a hide-finished chip, a crew dropdown, a date range and a sort row before the first job;
   Finance showed thirteen chips in three rows; Receipts, Inventory and Time opened with paragraphs explaining
   themselves. "Writing less is better."

   ⭐ SAME APPROACH AS js/156: the screens render exactly as they always have, and this pass walks the result
   afterwards. Nothing in js/08, js/40, js/72, js/31 or js/38 is edited. It fails open: anything unexpected and
   the screen is left as rendered. What it does, per screen:
     - JOBS: the wizard buttons go (the "+" sheet has Quote and Lead); everything between the heading and the
       list folds into a box behind one "⚙️ Filters" chip that shows how many filters are on. The box opens
       itself when a filter is active, and stays open once you have opened it this session.
     - LONG CHIP ROWS (phones only): a single-select .subnav row with six or more chips becomes one dropdown
       (Finance's 13 sub-views, Inventory's 6). Desktop keeps the chips; the sidebar carries them anyway.
     - TIPS: explanatory paragraphs on Receipts, Inventory and the clock-in card hide behind a "? Tips" chip.
     - SETTINGS: the Error log card moves to the bottom; a Notifications card lives there too (the banner now
       shows once, then this is where "Turn on" lives).
     - CLOCK-IN: the last job you clocked into is preselected next time (stored on this device).
   Pure helpers are node-testable (declutter-tests.js). */
var DCL_OPEN = {};    // tab -> the user opened the Filters box this session
var DCL_TIPS = {};    // tab -> tips shown this session
var DCL_CHIPS_MIN = 6;
/* how many Jobs filters are on, from a snapshot of the screen's state vars. QHIDE_DONE defaults to true, so
   only a change AWAY from the default counts. Pure. */
function dclJobsActive(st) {
  st = st || {};
  var n = 0;
  if (st.QSEARCH && String(st.QSEARCH).trim()) n++;
  if (st.QSTAGE_SET) n += Object.keys(st.QSTAGE_SET).filter(function (k) { return st.QSTAGE_SET[k]; }).length;
  if (st.QCREW_FILTER) n++;
  if (st.QDATE_FROM) n++;
  if (st.QDATE_TO) n++;
  if (st.QHIDE_DONE === false) n++;
  return n;
}
/* should a chip row become a dropdown? phones only, six or more chips, exactly one active (single-select). Pure. */
function dclRowToSelect(count, onCount, phone, min) {
  return !!phone && count >= (min || DCL_CHIPS_MIN) && onCount === 1;
}
if (typeof window !== "undefined") {
  var dclPhone = function () { return window.innerWidth < 900; };
  var dclEsc = function (s) { return (typeof esc === "function") ? esc(String(s == null ? "" : s)) : String(s == null ? "" : s); };
  function dclJobsState() {
    return {
      QSEARCH: (typeof QSEARCH !== "undefined") ? QSEARCH : "", QSTAGE_SET: (typeof QSTAGE_SET !== "undefined") ? QSTAGE_SET : {},
      QCREW_FILTER: (typeof QCREW_FILTER !== "undefined") ? QCREW_FILTER : "", QDATE_FROM: (typeof QDATE_FROM !== "undefined") ? QDATE_FROM : "",
      QDATE_TO: (typeof QDATE_TO !== "undefined") ? QDATE_TO : "", QHIDE_DONE: (typeof QHIDE_DONE !== "undefined") ? QHIDE_DONE : true
    };
  }
  /* ---- JOBS: fold the controls ---- */
  function dclJobs(view) {
    var list = document.getElementById("qlist"); if (!list || view.querySelector("[data-dcl='jobs']")) return;
    var kids = Array.prototype.slice.call(view.children);
    var start = -1, end = kids.indexOf(list); if (end < 1) return;
    for (var i = 0; i < end; i++) { var k = kids[i]; if (k.id === "qsearch") { start = i; break; } }
    /* the wizard row: the "+" sheet carries Quote and Lead now */
    kids.slice(0, end).forEach(function (k) { if (k.querySelector && k.querySelector("button[onclick='startWizard()']") && !k.querySelector("input")) k.style.display = "none"; });
    if (start < 0) return;                                     // no controls (no jobs yet) → nothing to fold
    var active = dclJobsActive(dclJobsState());
    var open = !!DCL_OPEN.jobs || active > 0;
    var box = document.createElement("div"); box.className = "dclbox"; box.setAttribute("data-dcl", "jobs"); box.style.display = open ? "" : "none";
    var row = document.createElement("div"); row.className = "dclrow";
    row.innerHTML = '<button class="btn ' + (active ? "acc" : "ghost") + ' sm dclchip" onclick="dclToggle(\'jobs\')">⚙️ Filters' + (active ? " · " + active + " on" : "") + '</button>';
    view.insertBefore(row, kids[start]);
    view.insertBefore(box, kids[start]);
    for (var j = start; j < end; j++) box.appendChild(kids[j]);
  }
  window.dclToggle = function (tab) { DCL_OPEN[tab] = !DCL_OPEN[tab]; var b = document.querySelector("[data-dcl='" + tab + "']"); if (b) b.style.display = DCL_OPEN[tab] ? "" : "none"; var c = document.querySelector(".dclrow .dclchip"); if (c) c.classList.toggle("open", !!DCL_OPEN[tab]); };
  /* ---- long single-select chip rows → one dropdown (phones) ---- */
  function dclChipRows(view) {
    if (!dclPhone()) return;
    Array.prototype.slice.call(view.querySelectorAll(".subnav")).forEach(function (row) {
      if (row.hasAttribute("data-dcl-select") || row.closest("[data-dcl]") || row.hasAttribute("data-secrow")) return;
      var chips = Array.prototype.slice.call(row.querySelectorAll("button.subbtn")).filter(function (b) { return !b.classList.contains("navpin"); });
      var on = chips.filter(function (b) { return b.classList.contains("on"); });
      if (!dclRowToSelect(chips.length, on.length, true)) return;
      if (chips.some(function (b) { return !b.getAttribute("onclick"); })) return;
      var sel = document.createElement("select"); sel.className = "dclselect"; sel.setAttribute("aria-label", "Section");
      chips.forEach(function (b, i) { var o = document.createElement("option"); o.value = String(i); o.textContent = (b.textContent || "").replace(/\s+/g, " ").trim(); if (b.classList.contains("on")) o.selected = true; sel.appendChild(o); });
      sel.onchange = function () { var b = chips[+sel.value]; if (b) b.click(); };
      row.setAttribute("data-dcl-select", "1"); row.style.display = "none";
      row.parentNode.insertBefore(sel, row);
    });
  }
  /* ---- the group's own sub-tab row (#subnav): five or more chips → one dropdown on phones, ☆ kept beside it ---- */
  function dclSubnav() {
    if (!dclPhone()) return;
    var el = document.getElementById("subnav"); if (!el) return;
    var row = el.querySelector(".subnav"); if (!row || row.hasAttribute("data-dcl-select")) return;
    var chips = Array.prototype.slice.call(row.querySelectorAll("button.subbtn")).filter(function (b) { return !b.classList.contains("navpin"); });
    var on = chips.filter(function (b) { return b.classList.contains("on"); });
    if (!dclRowToSelect(chips.length, on.length, true, 5)) return;
    var sel = document.createElement("select"); sel.className = "dclselect dclsub"; sel.setAttribute("aria-label", "Screen");
    chips.forEach(function (b, i) { var o = document.createElement("option"); o.value = String(i); o.textContent = (b.textContent || "").replace(/\s+/g, " ").trim(); if (b.classList.contains("on")) o.selected = true; sel.appendChild(o); });
    sel.onchange = function () { var b = chips[+sel.value]; if (b) b.click(); };
    var pin = row.querySelector("button.navpin");
    var wrap = document.createElement("div"); wrap.className = "dclsubrow"; wrap.appendChild(sel); if (pin) wrap.appendChild(pin);
    row.setAttribute("data-dcl-select", "1"); row.style.display = "none";
    el.insertBefore(wrap, row);
  }
  /* ---- tips: long explanatory paragraphs behind one "? Tips" chip ---- */
  var DCL_TIP_SEL = {
    receipts: ["#view .card .sub", "#view .card p.sub", "#view > .sub", "#view > p.muted"],
    inventory: ["#inv_body p.muted", "#view p.muted"],
    time: ["#view .card .sub"], today: ["#view .card .sub"]
  };
  function dclTips(view, tab) {
    var sels = DCL_TIP_SEL[tab]; if (!sels || view.querySelector("[data-dcl-tips]")) return;
    var nodes = [];
    sels.forEach(function (s) { Array.prototype.slice.call(document.querySelectorAll(s)).forEach(function (n) {
      if (nodes.indexOf(n) >= 0 || n.closest("[data-dcl-tip]")) return;
      var t = (n.textContent || "").trim();
      if (t.length < 110) return;                              // short status lines stay
      if (n.querySelector("input,select,button,a")) return;    // never hide a control
      if (tab === "today" && !/clock in|clocked|on the clock|odometer/i.test(t)) return;   // Today: only the clock-in card's advice
      nodes.push(n);
    }); });
    if (!nodes.length) return;
    var show = !!DCL_TIPS[tab];
    nodes.forEach(function (n) { n.setAttribute("data-dcl-tip", "1"); n.style.display = show ? "" : "none"; });
    var first = nodes[0]; var card = first.closest(".card"); var host = card || first.parentNode; if (!host) return;
    var chip = document.createElement("button"); chip.className = "btn ghost sm dcltips" + (show ? " open" : ""); chip.setAttribute("data-dcl-tips", tab);
    chip.textContent = show ? "? Hide tips" : "? Tips"; chip.onclick = function () { dclTipsToggle(tab); };
    host.insertBefore(chip, card ? host.firstChild : first);
  }
  window.dclTipsToggle = function (tab) {
    DCL_TIPS[tab] = !DCL_TIPS[tab];
    Array.prototype.slice.call(document.querySelectorAll("[data-dcl-tip]")).forEach(function (n) { n.style.display = DCL_TIPS[tab] ? "" : "none"; });
    Array.prototype.slice.call(document.querySelectorAll("[data-dcl-tips]")).forEach(function (c) { c.textContent = DCL_TIPS[tab] ? "? Hide tips" : "? Tips"; c.classList.toggle("open", !!DCL_TIPS[tab]); });
  };
  /* ---- Settings: error log last, notifications card ---- */
  function dclSettings(view) {
    if (view.querySelector("[data-dcl-notif]")) return;
    var cards = Array.prototype.slice.call(view.querySelectorAll(".card"));
    var err = cards.find(function (c) { return /Error log/.test(c.textContent || "") && c.querySelector("button"); });
    var st = null; try { st = (typeof pushBannerState === "function") ? pushBannerState() : null; } catch (e) {}
    var card = document.createElement("div"); card.className = "card"; card.setAttribute("data-dcl-notif", "1");
    var body = (st === "install") ? '<div class="sub" style="white-space:normal">Install J-Suite to your home screen first, then turn on message alerts here.</div><button class="btn ghost sm" onclick="pushInstallHelp()">How</button>'
      : (st === "grant") ? '<div class="sub" style="white-space:normal">Message alerts are off on this device.</div><button class="btn acc sm" onclick="enablePush()">Turn on</button>'
      : '<div class="sub" style="white-space:normal">Message alerts are on for this device.</div>';
    card.innerHTML = '<div class="row" style="align-items:center;gap:10px"><div class="grow"><div class="nm" style="font-size:15px">🔔 Notifications</div>' + body.split("<button")[0] + '</div>' + (body.indexOf("<button") >= 0 ? "<button" + body.split("<button")[1] : "") + '</div>';
    view.appendChild(card);
    if (err) view.appendChild(err);
  }
  /* ---- clock-in: remember the last job ---- */
  function dclClockDefaults() {
    var sel = document.getElementById("tc_job"); if (!sel || sel.getAttribute("data-dcl-job")) return;
    sel.setAttribute("data-dcl-job", "1");
    var last = null; try { last = localStorage.getItem("tc_last_job"); } catch (e) {}
    if (!last || !sel.querySelector('option[value="' + last + '"]') || sel.value === last) return;
    sel.value = last; try { if (typeof sel.onchange === "function") sel.onchange(); else sel.dispatchEvent(new Event("change")); } catch (e) {}
  }
  if (typeof tcClockIn === "function") {
    var _tci = tcClockIn;
    tcClockIn = function () { try { var s = document.getElementById("tc_job"); if (s && s.value) localStorage.setItem("tc_last_job", s.value); } catch (e) {} return _tci.apply(this, arguments); };
    window.tcClockIn = tcClockIn;
  }
  /* ---- the pass ---- */
  function declutter(tab) {
    try {
      var view = document.getElementById("view"); if (!view) return;
      if (tab === "jobs" || tab === "quotes") dclJobs(view);
      if (tab === "data") dclSettings(view);
      dclChipRows(view);
      dclSubnav();
      dclTips(view, tab);
      dclClockDefaults();
    } catch (e) { try { console.warn("declutter(" + tab + ") skipped:", e); } catch (_) {} }
  }
  window.declutter = declutter;
  /* run right after js/156's split, inside render()'s guarded block */
  if (typeof secSplit === "function") {
    var _ss = secSplit;
    secSplit = function (tab) { var r = _ss.apply(this, arguments); declutter(tab); return r; };
    window.secSplit = secSplit;
  }
  window.dclJobsActive = dclJobsActive; window.dclRowToSelect = dclRowToSelect;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { dclJobsActive: dclJobsActive, dclRowToSelect: dclRowToSelect, DCL_CHIPS_MIN: DCL_CHIPS_MIN }; }
