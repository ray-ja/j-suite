/* Per-org AI assistant (Phase 4). Each org may enable an assistant on its OWN Anthropic key — set up here via
   a one-way GUI (the key is stored server-side, never shown again, never billed to j-Suite). Setup is org-owner
   only; the server enforces it. Renders as a card inside the org-scoped Admin page. */
let ORG_AI_ST = null;   // cached status {enabled, hasKey, model} for the active org
function orgAiBase() { return ((S.sync && S.sync.url) || "").replace(/\/+$/, ""); }
function orgAiHeaders() { return { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
/* ⏱ A VISION READ THAT NEVER COMES BACK. Ray, 2026-08-26: "cap is reading 1 of 1, its been there a long time."
   `fetch` has no default timeout, so a request whose connection died mid-flight — the phone leaving the house
   wifi, a Tailscale re-key, the server wedged on its own timeout-less upstream call (now fixed in sync-server's
   aiSend) — leaves the promise permanently unsettled. The drain in js/88 awaits it, and an await that never
   resolves is not an error anyone can catch: no rejection, no log, no retry. Just a progress banner that stops
   moving and a feature that quietly stops working until the app is reloaded.

   ⛔ THE SERVER'S OWN CEILING IS 120s, SO THIS ONE IS DELIBERATELY LONGER (150s): when the server is alive it
   should always be the one to answer — with a real 502 and a real reason — and this only fires when nothing is
   coming back at all. Reversing them would abort healthy slow reads and hide the server's diagnosis.
   Returns a normal fetch promise; on the deadline it rejects like any network failure, which every caller
   already handles. Falls back to a plain fetch where AbortController is missing (old file:// contexts). */
function orgAiFetch(url, opts, ms) {
  var t = (typeof ms === "number" && ms > 0) ? ms : 150000;
  if (typeof AbortController !== "function") return fetch(url, opts);
  var ac = new AbortController(), timer = null, o = {};
  for (var k in (opts || {})) o[k] = opts[k];
  o.signal = ac.signal;
  timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, t);
  return fetch(url, o).then(
    function (r) { clearTimeout(timer); return r; },
    function (e) {
      clearTimeout(timer);
      /* an abort is OUR deadline, not "you're offline" — say which, so the caller can report it accurately */
      if (e && e.name === "AbortError") throw new Error("timed out after " + Math.round(t / 1000) + "s");
      throw e;
    }
  );
}
if (typeof window !== "undefined") window.orgAiFetch = orgAiFetch;
async function orgAiLoadStatus() {
  if (!orgAiBase()) { ORG_AI_ST = null; return; }
  try { const r = await fetch(orgAiBase() + "/api/org-ai/status?org=" + encodeURIComponent(S.biz), { headers: orgAiHeaders() }); ORG_AI_ST = r.ok ? await r.json() : null; } catch (e) { ORG_AI_ST = null; }
  const el = document.getElementById("orgai-card"); if (el) el.innerHTML = orgAiCardInner();
}
function orgAiCardInner() {
  const st = ORG_AI_ST || { enabled: false, hasKey: false, model: "" };
  const nm = (typeof orgName === "function") ? orgName(S.biz) : S.biz;
  if (!orgAiBase()) return `<div class="nm" style="font-size:15px">🤖 Assistant</div><div class="sub">Available when signed in online.</div>`;
  return `<div class="nm" style="font-size:15px">🤖 ${esc(nm)} assistant</div>
    <div class="sub" style="margin-bottom:8px">Optional AI that answers questions about <b>this organization's</b> data — on your own Anthropic API key (billed to you, never shared with other orgs).</div>
    <div class="row" style="align-items:center;gap:8px;margin-bottom:8px"><div class="grow"><strong>Enabled</strong><div class="sub">${st.enabled ? (st.hasKey ? "On" : "On — needs an API key") : "Off"}</div></div>
      <input type="checkbox" style="width:auto;flex:0 0 auto" ${st.enabled ? "checked" : ""} onchange="orgAiToggle(this.checked)"></div>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <button class="btn ghost sm" onclick="orgAiSetKey()">${st.hasKey ? "🔑 Replace API key" : "🔑 Set API key"}</button>
      <button class="btn ghost sm" onclick="orgAiSetModel()">Model: ${esc((st.model || "").replace("claude-", "") || "default")}</button>
      ${st.enabled && st.hasKey ? `<button class="btn acc sm" onclick="orgAiAsk()">💬 Ask a question</button>` : ""}
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      <button class="btn ghost sm" onclick="orgAiSetImageKey()">${st.hasImageKey ? "🖼 Replace image key (Gemini)" : "🖼 Set image key (Gemini)"}</button>
      <span class="sub" style="align-self:center">${st.hasImageKey ? "✓ image key set — powers the 'show the after' photo tool" : "for before/after landscaping mockups"}</span>
    </div>
    <div class="sub" style="white-space:normal;margin-top:8px;font-size:12px;line-height:1.4">
      Needs an <b>Anthropic API key</b> (powers this assistant + its Sentinel daily brief).
      Get one at <b>console.anthropic.com → Settings → API Keys → Create Key</b> — a standard key works, no special scopes.
      Billing is on your own Anthropic account. The key is stored <b>server-side only and never shown again</b> after saving.
    </div>
    ${orgAiModelsSection(st)}`;
}
// PER-FUNCTION AI MODEL PICKER — one dropdown per AI function. The allowlist + labels mirror the server's AI_MODELS
// (the server re-validates on save AND on resolve, so a client can never select a non-allowlisted / free-form model).
const ORG_AI_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 · fastest · $" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 · balanced · $$" },
  { id: "claude-opus-4-8", label: "Opus 4.8 · smartest · $$$$" },
  { id: "claude-fable-5", label: "Fable 5 · creative · $$$" }
];
const ORG_AI_FN_META = [
  { fn: "receipt", emoji: "🧾", label: "Receipt reading", def: "claude-sonnet-4-6" },
  { fn: "receiptEscalate", emoji: "🔍", label: "Receipt reread", def: "claude-opus-4-8" },
  { fn: "assistant", emoji: "💬", label: "Cap assistant", def: "claude-sonnet-4-6" },
  { fn: "ask", emoji: "❓", label: "Cap Q&A", def: "claude-haiku-4-5-20251001" },
  { fn: "digest", emoji: "📊", label: "Daily digest", def: "claude-haiku-4-5-20251001" }
];
function orgAiModelLabel(id) { const m = ORG_AI_MODELS.find(x => x.id === id); return m ? m.label : (id || "").replace("claude-", ""); }
function orgAiModelsSection(st) {
  const sel = (st && st.models) || {};
  const rows = ORG_AI_FN_META.map(f => {
    const cur = (typeof sel[f.fn] === "string") ? sel[f.fn] : "";
    const opts = `<option value="">Default — ${esc(orgAiModelLabel(f.def))}</option>`
      + ORG_AI_MODELS.map(m => `<option value="${esc(m.id)}"${cur === m.id ? " selected" : ""}>${esc(m.label)}</option>`).join("");
    return `<label class="row" style="align-items:center;gap:8px;margin-bottom:6px">
      <span class="grow" style="font-size:13px">${f.emoji} ${esc(f.label)}</span>
      <select id="oai_m_${esc(f.fn)}" style="flex:0 0 auto;max-width:58%">${opts}</select></label>`;
  }).join("");
  return `<div style="margin-top:12px;border-top:1px solid var(--line,#333);padding-top:10px">
    <div class="nm" style="font-size:13px">🎛️ AI models per function</div>
    <div class="sub" style="white-space:normal;font-size:11px;line-height:1.4;margin-bottom:8px">ℹ Receipts read on the smart model by default; bump Q&amp;A / digest only if you need it. Unset = the shown default.</div>
    ${rows}
    <button class="btn acc sm" style="margin-top:6px" onclick="orgAiSaveModels()">Save models</button></div>`;
}
window.orgAiSaveModels = function () {
  const models = {};
  ORG_AI_FN_META.forEach(f => { const el = document.getElementById("oai_m_" + f.fn); if (el) models[f.fn] = el.value || ""; });
  orgAiPost({ models: models }).then(() => { if (typeof toast === "function") toast("AI models saved."); });
};
function orgAiCard() { setTimeout(orgAiLoadStatus, 30); return `<div class="card" id="orgai-card" style="margin-top:8px;border-left:3px solid var(--acc)">${orgAiCardInner()}</div>`; }
async function orgAiPost(bodyObj) {
  try {
    const r = await fetch(orgAiBase() + "/api/org-ai/config", { method: "POST", headers: orgAiHeaders(), body: JSON.stringify(Object.assign({ org: S.biz }, bodyObj)) });
    if (r.ok) ORG_AI_ST = await r.json(); else { alert("Couldn't save — only an organization owner can set this up."); }
  } catch (e) { alert("Couldn't reach the server."); }
  const el = document.getElementById("orgai-card"); if (el) el.innerHTML = orgAiCardInner();
}
window.orgAiToggle = function (on) { orgAiPost({ enabled: !!on }); };
window.orgAiSetKey = function () { const k = prompt("Paste this organization's Anthropic API key (sk-ant-…).\n\nGet one at console.anthropic.com → Settings → API Keys → Create Key. A standard key works — no special scopes needed. Billing is on your own Anthropic account.\n\nIt is stored on the server only and never shown again."); if (k == null || !k.trim()) return; orgAiPost({ apiKey: k.trim(), enabled: true }).then(() => alert("Key saved. The assistant is ready.")); };
window.orgAiSetImageKey = function () { const k = prompt("Paste this organization's Google Gemini API key (AIza…) — this powers the before/after landscaping image tool.\n\nGet one FREE at aistudio.google.com → Get API key → Create API key. Image generation may need billing enabled on the Google project (a few cents per image).\n\nStored on the server only and never shown again."); if (k == null || !k.trim()) return; orgAiPost({ imageKey: k.trim() }).then(() => alert("Gemini image key saved. Tell me and I'll test one photo.")); };
window.orgAiSetModel = function () { const m = prompt("Model id:\n• claude-haiku-4-5-20251001 — cheapest, fast\n• claude-sonnet-4-6 — smarter", (ORG_AI_ST && ORG_AI_ST.model) || "claude-haiku-4-5-20251001"); if (m == null || !m.trim()) return; orgAiPost({ model: m.trim() }); };
window.orgAiAsk = function () {
  modal("Ask the " + ((typeof orgName === "function") ? orgName(S.biz) : S.biz) + " assistant", `
    <textarea id="oai_q" rows="3" placeholder="e.g. Which quotes are still open? What did we spend this month?"></textarea>
    <button class="btn acc" style="margin-top:10px" onclick="orgAiDoAsk()">Ask</button>
    <div id="oai_ans" class="sub" style="white-space:pre-wrap;margin-top:12px"></div>`);
};
window.orgAiDoAsk = async function () {
  const q = ((document.getElementById("oai_q") || {}).value) || ""; if (!q.trim()) return;
  const ans = document.getElementById("oai_ans"); if (ans) ans.textContent = "Thinking…";
  try { const r = await fetch(orgAiBase() + "/api/org-ai/ask", { method: "POST", headers: orgAiHeaders(), body: JSON.stringify({ org: S.biz, question: q }) }); const j = await r.json(); if (ans) ans.textContent = j.answer || j.error || "No answer."; }
  catch (e) { if (ans) ans.textContent = "Request failed."; }
};
