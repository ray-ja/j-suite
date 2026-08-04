/* ---------- ORG PORTABILITY (js/124) — export / import / delete a whole organization ------------------
   Ray, 2026-08-04: "so are all the organizations separate folders i can move / delete? thats how it should be,
   totally self contained and portable."

   They are not separate folders on disk, and deliberately still aren't — one data.json is a single atomic
   write, and splitting it into four would turn the one unrecoverable failure surface into a partial-write
   problem. Two other things block a literal split: most accounts belong to more than one org, and blobs carry
   no org tag (ownership is derived by scanning records).

   So this delivers the PROPERTY instead of the layout. Export writes a real, self-contained folder on the
   server — org.json + the org's actual photo files + a README — which can be moved, copied, archived or
   deleted like any other folder. Import reads one back, merging last-write-wins so it can update records but
   never drop them. Delete always takes a full export first.

   Super-admin only; the server enforces that independently of this UI. */

var ORGP = { busy: false, msg: "", list: null };

function orgpBase() { return (typeof orgAiBase === "function") ? orgAiBase() : (((S.sync && S.sync.url) || "").replace(/\/+$/, "")); }
function orgpHeaders() { return (typeof orgAiHeaders === "function") ? orgAiHeaders() : { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
function orgpCan() { return !!orgpBase() && !!(S.sync && S.sync.token) && (typeof isSuperAdmin === "function" ? isSuperAdmin() : (typeof isOwner === "function" && isOwner())); }
function orgpOrgs() {
  return (S.registry || []).filter(function (r) { return r && r.id; })
    .map(function (r) { return { id: r.id, name: r.name || r.id }; });
}
function orgpSet(msg) { ORGP.msg = msg || ""; var el = document.getElementById("orgp_msg"); if (el) el.innerHTML = msg ? esc(msg) : ""; }

/* ---- the card on Settings ---- */
function orgpCardHTML() {
  if (!orgpCan()) return "";
  var orgs = orgpOrgs();
  return '<h2>Organizations</h2>'
    + '<div class="card">'
    + '<div class="sub" style="white-space:normal">Each organization can be written out as a self-contained folder on the server — its records, the people in it, and its photos — which you can move, copy, archive or delete. Importing merges by record: it can update, never drop.</div>'
    + '<label style="margin-top:10px">Organization</label>'
    + '<select id="orgp_org">' + orgs.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === S.biz ? " selected" : "") + '>' + esc(o.name) + '</option>';
      }).join("") + '</select>'
    + '<button class="btn acc" style="margin-top:10px;width:100%" onclick="orgpExport()">📦 Export this organization</button>'
    + '<button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="orgpRefresh()">List exports on the server</button>'
    + '<button class="btn ghost sm" style="margin-top:8px;width:100%;color:var(--danger)" onclick="orgpDelete()">Delete this organization…</button>'
    + '<div id="orgp_msg" class="note" style="margin-top:8px;white-space:normal"></div>'
    + '<div id="orgp_list" style="margin-top:8px"></div>'
    + '</div>';
}

function orgpPick() { var el = document.getElementById("orgp_org"); return el ? el.value : S.biz; }
function orgpName(id) { var o = orgpOrgs().find(function (x) { return x.id === id; }); return o ? o.name : id; }

/* ---- export ---- */
if (typeof window !== "undefined") window.orgpExport = function () {
  if (ORGP.busy) return;
  var org = orgpPick();
  ORGP.busy = true; orgpSet("Writing the export…");
  fetch(orgpBase() + "/api/org/export", { method: "POST", headers: orgpHeaders(), body: JSON.stringify({ org: org, withPhotos: true }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      ORGP.busy = false;
      if (!res.ok) { orgpSet("Export failed: " + ((res.j && res.j.error) || "unknown")); return; }
      var j = res.j;
      orgpSet("✓ Exported " + j.records + " records, " + j.accounts + " account(s) and " + j.photos + " photo(s) to  org-exports/" + j.name
        + (j.missingPhotos ? "  (" + j.missingPhotos + " referenced photo file(s) were already missing)" : ""));
      window.orgpRefresh();
    })
    .catch(function (e) { ORGP.busy = false; orgpSet("Export failed: " + ((e && e.message) || "unknown")); });
};

/* ---- list what's on the server ---- */
if (typeof window !== "undefined") window.orgpRefresh = function () {
  fetch(orgpBase() + "/api/org/exports", { headers: orgpHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var el = document.getElementById("orgp_list"); if (!el) return;
      var list = (d && d.exports) || [];
      if (!list.length) { el.innerHTML = '<div class="muted" style="font-size:12px">No exports yet.</div>'; return; }
      el.innerHTML = '<div class="sub" style="font-weight:700;margin-bottom:4px">On the server (' + esc(d.dir || "") + ')</div>'
        + list.map(function (x) {
            return '<div class="row" style="gap:6px;align-items:center;margin-bottom:4px">'
              + '<div class="grow"><div style="font-size:13px">' + esc(x.name) + '</div>'
              + '<div class="sub" style="font-size:11px">' + esc(x.orgName) + ' · ' + x.accounts + ' account(s) · ' + x.photos + ' photo(s)</div></div>'
              + '<button class="btn ghost sm" onclick="orgpImport(\'' + esc(x.name) + '\')">Import</button></div>';
          }).join("");
    })
    .catch(function () {});
};

/* ---- import ---- */
if (typeof window !== "undefined") window.orgpImport = function (name) {
  if (ORGP.busy) return;
  if (!confirm("Import " + name + "?\n\nThis merges by record — it can add or update records, but never removes any.")) return;
  ORGP.busy = true; orgpSet("Importing…");
  fetch(orgpBase() + "/api/org/import", { method: "POST", headers: orgpHeaders(), body: JSON.stringify({ name: name, mode: "merge" }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      ORGP.busy = false;
      var j = res.j || {};
      if (!res.ok || !j.ok) { orgpSet("Import failed: " + (j.error || "unknown")); return; }
      orgpSet("✓ Imported " + esc(j.orgId) + " — " + j.records + " records, " + j.accounts + " account(s), "
        + (j.photosRestored || 0) + " photo(s) restored." + (j.existed ? " (merged into the existing organization)" : "")
        + " Pull to see it.");
      if (typeof syncNow === "function") syncNow();
    })
    .catch(function (e) { ORGP.busy = false; orgpSet("Import failed: " + ((e && e.message) || "unknown")); });
};

/* ---- delete ---- */
if (typeof window !== "undefined") window.orgpDelete = function () {
  if (ORGP.busy) return;
  var org = orgpPick(), name = orgpName(org);
  var typed = prompt("Delete \"" + name + "\" and everything in it?\n\nA full export is taken first, so this is recoverable.\n\nType the organization's name exactly to confirm:");
  if (typed === null) return;
  if (String(typed).trim() !== String(name).trim()) { orgpSet("Name didn't match — nothing was deleted."); return; }
  ORGP.busy = true; orgpSet("Backing up, then deleting…");
  fetch(orgpBase() + "/api/org/delete", { method: "POST", headers: orgpHeaders(), body: JSON.stringify({ org: org, confirmName: typed }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      ORGP.busy = false;
      var j = res.j || {};
      if (!res.ok || !j.ok) { orgpSet("Delete failed: " + (j.error || "unknown")); return; }
      orgpSet("✓ Deleted. A full copy was saved first as org-exports/" + esc(j.backup || "?")
        + " — " + (j.photosRemoved || 0) + " photo(s) removed, " + (j.memberships || 0) + " membership(s) cleared. No accounts were deleted.");
      if (typeof syncNow === "function") syncNow();
      window.orgpRefresh();
    })
    .catch(function (e) { ORGP.busy = false; orgpSet("Delete failed: " + ((e && e.message) || "unknown")); });
};

if (typeof window !== "undefined") { window.orgpCardHTML = orgpCardHTML; window.orgpCan = orgpCan; }
