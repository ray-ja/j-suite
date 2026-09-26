/* ---------- PHONE NAV: FIVE THINGS AT THE BOTTOM (js/184) ----------
   Ray, 2026-09-22, UX audit: the phone bar carried eleven groups and scrolled sideways; only six fit.
   Apple HIG / Material: a bottom bar holds three to five destinations, the rest go behind "More".

   WHAT THIS DOES (phones only, < 900px; the desktop sidebar is untouched):
     - keeps FOUR primary groups in the bar, picked per org kind (business: Today · Work · Money · People;
       personal: Today · To-Do · Journal · Budget), filled from the visible groups when a preferred one is
       missing, so an org never ends up with an empty bar;
     - adds a fifth button, "More", which opens a sheet: ★ favorites first, then every other group;
     - nothing is removed: every group button still exists in <nav> (hidden by CSS on phones), so any
       code that looks for them keeps working, and the desktop shows them all as before.
   Pure helpers are node-testable (phone-nav-tests.js). */
const PHONE_NAV_MAX = 4;
const PHONE_NAV_PREF = {
  business: ["today", "work", "money", "team"],
  personal: ["today", "todo", "journal", "budget"]
};
/* pick the primary group keys: preferred ones that are visible, in preference order, then fill from the
   visible list in its own order. Never more than max. Pure. */
function phonePrimaryPick(visible, pref, max) {
  visible = (visible || []).filter(Boolean); pref = pref || []; max = max || PHONE_NAV_MAX;
  const out = [];
  pref.forEach(k => { if (visible.indexOf(k) >= 0 && out.indexOf(k) < 0 && out.length < max) out.push(k); });
  visible.forEach(k => { if (out.indexOf(k) < 0 && out.length < max) out.push(k); });
  return out;
}
/* is the More button the "current" one? (the open group is not in the bar) */
function phoneMoreIsOn(primary, curKey) { return !!curKey && (primary || []).indexOf(curKey) < 0; }

if (typeof window !== "undefined") {
  function phoneNavKind() {
    try { return (typeof orgIsPersonalOrg === "function" && orgIsPersonalOrg()) ? "personal" : "business"; } catch (e) { return "business"; }
  }
  /* decorate the freshly rendered <nav>: mark the primaries, append More */
  function phoneNavDecorate(nav) {
    const btns = Array.from(nav.querySelectorAll("button[data-group]"));
    if (!btns.length) return;
    const visible = btns.map(b => b.dataset.group);
    const primary = phonePrimaryPick(visible, PHONE_NAV_PREF[phoneNavKind()], PHONE_NAV_MAX);
    btns.forEach(b => { const i = primary.indexOf(b.dataset.group); if (i >= 0) b.setAttribute("data-phone", String(i + 1)); else b.removeAttribute("data-phone"); });
    const curKey = (typeof tabGroup === "function" && typeof TAB !== "undefined") ? tabGroup(TAB).key : "";
    const more = document.createElement("button");
    more.className = "navmore" + (phoneMoreIsOn(primary, curKey) ? " on" : "");
    more.setAttribute("data-more", "1"); more.setAttribute("aria-label", "More screens");
    more.innerHTML = '<span class="ic">☰</span>More';
    more.onclick = function () { phoneMoreOpen(); };
    nav.appendChild(more);
    window.PHONE_NAV_PRIMARY = primary;
    phoneMoreBadgeSync();
    /* DESKTOP (Phase 5, 2026-09-26): the same five-things rule in the sidebar. Primaries and the open group
       stay as rows; everything else folds under a "More" row that expands in place (remembered per device).
       Material 3 calls this a navigation rail with a drawer; the phone bar and the sidebar now agree. */
    var moreOpen = false; try { moreOpen = localStorage.getItem("jra_nav_more") === "1"; } catch (e) {}
    var rest = btns.filter(function (b) { return primary.indexOf(b.dataset.group) < 0; });
    rest.forEach(function (b) { b.setAttribute("data-more", "1"); var kids = b.nextElementSibling; if (kids && kids.classList.contains("navkids")) kids.setAttribute("data-more", "1"); });
    var hidden = rest.filter(function (b) { return b.dataset.group !== curKey; }).length;
    if (rest.length) {
      var tog = document.createElement("button"); tog.className = "navmoretog" + (moreOpen ? " open" : ""); tog.setAttribute("data-moretog", "1");
      tog.innerHTML = '<span class="ic">' + (moreOpen ? "▾" : "▸") + '</span>' + (moreOpen ? "Less" : "More") + (hidden && !moreOpen ? ' <span class="navbadge" style="color:var(--muted)">' + hidden + '</span>' : "");
      tog.onclick = function () { var on = !nav.classList.contains("moreopen"); nav.classList.toggle("moreopen", on); try { localStorage.setItem("jra_nav_more", on ? "1" : "0"); } catch (e) {} if (typeof renderNav === "function") renderNav(); };
      nav.insertBefore(tog, rest[0]);
      nav.classList.toggle("moreopen", moreOpen);
    }
  }
  /* unread messages used to show on the Messages button; on a phone that button is inside More now, so the
     count rides on More instead (mirrors #msgbadge, which js/47 keeps up to date) */
  function phoneMoreBadgeSync() {
    try {
      const nav = document.querySelector("nav"); if (!nav) return;
      const more = nav.querySelector("button.navmore"); if (!more) return;
      const src = nav.querySelector("#msgbadge");
      const txt = (src && src.style.display !== "none") ? (src.textContent || "").trim() : "";
      let b = more.querySelector(".navbadge");
      if (!txt) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement("span"); b.className = "navbadge"; more.appendChild(b); }
      b.textContent = txt;
    } catch (e) {}
  }
  window.phoneMoreBadgeSync = phoneMoreBadgeSync;
  if (typeof updateMsgBadge === "function") {
    const _umb = updateMsgBadge;
    updateMsgBadge = function () { const r = _umb.apply(this, arguments); phoneMoreBadgeSync(); return r; };
    window.updateMsgBadge = updateMsgBadge;
  }
  window.phoneMoreOpen = function () {
    const nav = document.querySelector("nav"); if (!nav) return;
    const E = (typeof esc === "function") ? esc : (s => String(s == null ? "" : s));
    const primary = window.PHONE_NAV_PRIMARY || [];
    const curKey = (typeof tabGroup === "function" && typeof TAB !== "undefined") ? tabGroup(TAB).key : "";
    let h = "";
    /* ★ favorites first (js/176), same keys the sidebar uses */
    try {
      const favs = (typeof navFavRows === "function") ? navFavRows() : [];
      if (favs.length) h += `<div class="pmhead">★ Favorites</div><div class="pmgrid">` + favs.map(r => `<button class="pmbtn" onclick="closeModal();navFavGo('${E(r.key)}')"><span class="ic">${r.icon}</span><span>${E(r.label)}</span></button>`).join("") + `</div>`;
    } catch (e) {}
    const rest = Array.from(nav.querySelectorAll("button[data-group]")).filter(b => primary.indexOf(b.dataset.group) < 0);
    h += `<div class="pmhead">Everything else</div><div class="pmgrid">` + rest.map(b => {
      const ic = b.querySelector(".ic") ? b.querySelector(".ic").textContent : "•";
      const label = (b.textContent || "").replace(ic, "").trim().replace(/\d+\+?$/, "").trim();
      return `<button class="pmbtn${b.dataset.group === curKey ? " on" : ""}" onclick="closeModal();navGroup('${E(b.dataset.group)}')"><span class="ic">${E(ic)}</span><span>${E(label)}</span></button>`;
    }).join("") + `</div>`;
    h += `<div class="sub" style="margin-top:12px;white-space:normal">Pin a screen with the ☆ on its sub-tab row and it shows up here first.</div>`;
    if (typeof modal === "function") modal("More", h);
  };
  if (typeof renderNav === "function") {
    const _rn = renderNav;
    renderNav = function () {
      _rn();
      try { const nav = document.querySelector("nav"); if (nav) phoneNavDecorate(nav); } catch (e) {}
    };
  }
  /* the header is tight on a phone once the 🔍 is there: hide the "Clocked out" pill on phones (Today is one tap
     away and the "+" sheet has Clock in); it comes back the moment a shift is open, which is when it matters */
  if (typeof renderClockPill === "function") {
    const _rcp = renderClockPill;
    renderClockPill = function () {
      _rcp();
      try {
        const el = document.getElementById("clockpill"); if (!el) return;
        const open = (typeof tcMyOpen === "function") ? tcMyOpen() : null;
        if (!open && window.innerWidth < 900) el.style.display = "none";
      } catch (e) {}
    };
    window.renderClockPill = renderClockPill;
  }
  window.phonePrimaryPick = phonePrimaryPick; window.phoneMoreIsOn = phoneMoreIsOn;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { phonePrimaryPick, phoneMoreIsOn, PHONE_NAV_PREF, PHONE_NAV_MAX }; }
