/* Cloudflare Pages Function — POST /lead (Jamieson Automation)
 *
 * The site is a static host (Cloudflare Pages). The old forms POSTed to /thanks.html, which a static
 * host answers with 405 Method Not Allowed. This function accepts the POST, captures the lead, and
 * 302-redirects the visitor to /thanks.html (a normal GET) — so the form works and there is no 405.
 *
 * Where the email is captured (best-effort, in order; a failure never blocks the redirect):
 *   1. console.log("LEAD …")  — always; visible in the Pages dashboard real-time logs / `wrangler pages deployment tail`.
 *   2. KV  — if a KV namespace is bound as `LEADS` (Pages → Settings → Functions → KV bindings),
 *            each lead is stored under `lead:<ts>:<rand>` and is retrievable from the dashboard/API.
 *   3. Webhook — if env var `LEAD_WEBHOOK` is set, the lead JSON is POSTed there (email/Zapier/etc).
 * Ray: bind a `LEADS` KV namespace (or set LEAD_WEBHOOK) once for durable capture; until then leads
 * still arrive in the live logs and the visitor still reaches the thank-you page.
 */
function thanks(request) { return Response.redirect(new URL("/thanks.html", request.url).toString(), 302); }

export async function onRequestPost(context) {
  const { request, env } = context;
  let d = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) d = await request.json();
    else { const fd = await request.formData(); for (const [k, v] of fd.entries()) d[k] = typeof v === "string" ? v : ""; }
  } catch (e) { /* malformed body — still send them to thanks, no 500 */ }

  // honeypot: silently accept bots, store nothing
  if (d["bot-field"]) return thanks(request);

  const cut = (v, n) => String(v == null ? "" : v).slice(0, n);
  const lead = {
    email: cut(d.email, 200), name: cut(d.name, 120), phone: cut(d.phone, 40),
    message: cut(d.message || d.details, 2000),
    form: cut(d["form-name"] || d.source || "lead", 60),
    magnet: cut(d.magnet, 120), service: cut(d.service, 80), source: cut(d.source, 60), variant: cut(d.variant, 8),
    ts: new Date().toISOString(), ua: cut(request.headers.get("user-agent"), 200), ref: cut(request.headers.get("referer"), 300)
  };

  try { console.log("LEAD " + JSON.stringify(lead)); } catch (e) {}
  try { if (env && env.LEADS) await env.LEADS.put("lead:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8), JSON.stringify(lead)); } catch (e) {}
  try { if (env && env.LEAD_WEBHOOK) await fetch(env.LEAD_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lead) }); } catch (e) {}

  return thanks(request);
}

// A stray GET to /lead should just land on the thank-you page (never a 405 / dead end).
export async function onRequestGet(context) { return thanks(context.request); }
