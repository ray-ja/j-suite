/* ---------- FAVORITES (js/176) — the screens he uses every day, always in reach ----------
   Ray, 2026-09-15: "We have so many different pages in the menu. Can you make, like, a favorite system so I
   can just have it always show the ones I use every day?"

   A favorite is a DESTINATION KEY — the same "tab/sub" key js/155 already uses for the deep nav
   ("finance/bank", "accounts/customers", "schedule/" for a plain tab) — so any screen the menu knows how to
   reach can be pinned, at any level, and it opens through the screen's own setter exactly like the sidebar row.

   WHERE THEY SHOW:
     desktop  — a ★ Favorites block at the top of the sidebar, above the groups, whatever group is open.
     phone    — the favorites are the FIRST buttons in the bottom bar, before the groups, so the daily ones are
                on screen without scrolling the bar. The groups stay after them; nothing is removed.
   HOW TO PIN: desktop rows carry a ☆ on the right; on the phone a ☆ sits at the end of the sub-tab row and pins
   the screen you are on. Tap again to unpin. Order = the order you pinned (unpin + re-pin moves one to the end).

   STORED on the signed-in account (u.navFavs), which already syncs — so it follows him from phone to desktop.
   Signed-out devices fall back to localStorage. Never more than a label-and-key list; nothing else changes. */
const NAVFAV_MAX = 12;

/* ===================== pure (node-testable) ===================== */
function navFavKeyOf(tab, sub) { return String(tab || "") + "/" + String(sub || ""); }
/* resolve a key to a destination row: a registered deep row wins; else a plain tab from TAB_META; else null */
function navFavResolve(key, deep, tabMeta, canSee) {
  const parts = String(key || "").split("/"); const tab = parts[0], sub = parts.slice(1).join("/");
  if (!tab) return null;
  if (typeof canSee === "function" && !canSee(tab)) return null;
  const d = (deep || []).find(x => x && x.tab === tab && String(x.sub || "") === sub);
  if (d) { if (typeof d.only === "function" && !d.only()) return null; return { key: key, tab: tab, sub: sub, setter: d.setter || "", icon: d.icon || "•", label: d.label || tab, plain: false }; }
  if (sub) return null;
  const m = (tabMeta || {})[tab]; if (!m) return null;
  return { key: key, tab: tab, sub: "", setter: "", icon: m.i || "•", label: m.l || tab, plain: true };
}
function navFavToggleList(list, key, max) {
  list = (list || []).filter(Boolean); max = max || NAVFAV_MAX;
  if (list.indexOf(key) >= 0) return list.filter(k => k !== key);
  return list.concat([key]).slice(-max);
}

/* ===================== storage ===================== */
function navFavUser() { return (typeof curUser === "function") ? curUser() : null; }
function navFavList() {
  const u = navFavUser();
  if (u && Array.isArray(u.navFavs)) return u.navFavs.filter(Boolean);
  try { return JSON.parse(localStorage.getItem("jra_navfavs") || "[]") || []; } catch (e) { return []; }
}
function navFavSave(list) {
  const u = navFavUser();
  if (u) { u.navFavs = list; if (typeof touch === "function") touch(u); if (typeof save === "function") save(); if (typeof scheduleAutoPush === "function") scheduleAutoPush(); }
  else { try { localStorage.setItem("jra_navfavs", JSON.stringify(list)); } catch (e) {} }
}
function navFavIs(key) { return navFavList().indexOf(key) >= 0; }
/* the key of whatever is on screen right now */
function navFavCurrentKey() {
  let k = (typeof navDeepCurrent === "function") ? navDeepCurrent() : "";
  if (k) return k;
  return navFavKeyOf((typeof TAB !== "undefined") ? TAB : "", "");
}
function navFavRows() {
  const deep = (typeof NAV_DEEP !== "undefined") ? NAV_DEEP : [];
  const meta = (typeof TAB_META !== "undefined") ? TAB_META : {};
  const see = (typeof navCanSee === "function") ? navCanSee : null;
  return navFavList().map(k => navFavResolve(k, deep, meta, see)).filter(Boolean);
}

/* ===================== actions ===================== */
if (typeof window !== "undefined") {
  window.navFavToggle = function (key) {
    key = key || navFavCurrentKey(); if (!key) return;
    const before = navFavList().length;
    const list = navFavToggleList(navFavList(), key);
    navFavSave(list);
    if (list.length > before && typeof toast === "function") toast("★ Pinned to favorites");
    if (typeof renderNav === "function") renderNav();
    if (typeof renderSubnav === "function") renderSubnav();
  };
  window.navFavGo = function (key) {
    const r = navFavResolve(key, (typeof NAV_DEEP !== "undefined") ? NAV_DEEP : [], (typeof TAB_META !== "undefined") ? TAB_META : {}, (typeof navCanSee === "function") ? navCanSee : null);
    if (!r) return;
    if (r.plain) { if (typeof navSub === "function") navSub(r.tab); return; }
    if (typeof navDeepGo === "function") navDeepGo(r.tab, r.sub, r.setter);
  };
}

/* ===================== rendering ===================== */
function navFavBlockHTML() {
  const rows = navFavRows(); if (!rows.length) return "";
  const cur = navFavCurrentKey();
  const badges = (typeof window !== "undefined" && window.NAV_BADGES) || {};
  return `<div class="navfavs"><div class="navhead navfavhead">★ Favorites</div>` + rows.map(r => {
    const badge = badges[r.key] ? badges[r.key]() : "";
    return `<button class="navfav${r.key === cur ? " on" : ""}" data-fav="${esc(r.key)}" onclick="navFavGo('${esc(r.key)}')"><span class="ic">${r.icon}</span><span class="lbl">${esc(r.label)}</span>${badge ? `<span class="navbadge">${esc(badge)}</span>` : ""}<span class="navstar on" title="Unpin" onclick="event.stopPropagation();navFavToggle('${esc(r.key)}')">★</span></button>`;
  }).join("") + `</div>`;
}
/* the ☆ on every expanded sidebar row (desktop) */
function navFavDecorateDeep(nav) {
  nav.querySelectorAll(".navkids button.navsub[data-deep]").forEach(b => {
    if (b.querySelector(".navstar")) return;
    const key = b.getAttribute("data-deep"); const on = navFavIs(key);
    const s = document.createElement("span");
    s.className = "navstar" + (on ? " on" : ""); s.title = on ? "Unpin" : "Pin to favorites"; s.textContent = on ? "★" : "☆";
    s.onclick = function (ev) { ev.stopPropagation(); navFavToggle(key); };
    b.appendChild(s);
  });
}
(function () {
  if (typeof window === "undefined") return;
  if (typeof renderNav === "function") {
    const _rn = renderNav;
    renderNav = function () {
      _rn();
      const nav = document.querySelector("nav"); if (!nav) return;
      try {
        const html = navFavBlockHTML();
        if (html) {
          const wrap = document.createElement("div"); wrap.innerHTML = html; const block = wrap.firstChild;
          const search = nav.querySelector(".navsearch");
          if (search && search.nextSibling) nav.insertBefore(block, search.nextSibling); else if (search) nav.appendChild(block); else nav.insertBefore(block, nav.firstChild);
        }
        navFavDecorateDeep(nav);
      } catch (e) {}
    };
  }
  /* the phone's pin control: a ☆ at the end of the sub-tab row for the screen you're on */
  if (typeof renderSubnav === "function") {
    const _rs = renderSubnav;
    renderSubnav = function () {
      _rs();
      try {
        const el = document.getElementById("subnav"); if (!el) return;
        const key = navFavCurrentKey(); const on = navFavIs(key);
        const btn = `<button class="subbtn navpin${on ? " on" : ""}" title="${on ? "Unpin" : "Pin this screen to favorites"}" onclick="navFavToggle('${esc(key)}')">${on ? "★" : "☆"}</button>`;
        let row = el.querySelector(".subnav");
        if (!row) { el.innerHTML = `<div class="subnav">${btn}</div>`; }
        else row.insertAdjacentHTML("beforeend", btn);
      } catch (e) {}
    };
  }
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { navFavKeyOf: navFavKeyOf, navFavResolve: navFavResolve, navFavToggleList: navFavToggleList, NAVFAV_MAX: NAVFAV_MAX };
}
