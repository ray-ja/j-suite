/* Per-org AI assistant (Phase 4). Each org may enable an assistant on its OWN Anthropic key — set up here via
   a one-way GUI (the key is stored server-side, never shown again, never billed to j-Suite). Setup is org-owner
   only; the server enforces it. Renders as a card inside the org-scoped Admin page. */
let ORG_AI_ST = null;   // cached status {enabled, hasKey, model} for the active org
function orgAiBase() { return ((S.sync && S.sync.url) || "").replace(/\/+$/, ""); }
function orgAiHeaders() { return { "Content-Type": "application/json", "Authorization": "Bearer " + ((S.sync && S.sync.token) || "") }; }
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
    <div class="sub" style="white-space:normal;margin-top:8px;font-size:12px;line-height:1.4">
      Needs an <b>Anthropic API key</b> (powers this assistant + its Sentinel daily brief).
      Get one at <b>console.anthropic.com → Settings → API Keys → Create Key</b> — a standard key works, no special scopes.
      Billing is on your own Anthropic account. The key is stored <b>server-side only and never shown again</b> after saving.
    </div>`;
}
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
