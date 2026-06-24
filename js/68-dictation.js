/* ---------- VOICE DICTATION — free, on-device browser speech-to-text into any text box ----------
   A floating 🎤 appears when you tap into a text field; tap it to dictate, tap again (⏹) to stop.
   Uses the browser's built-in Web Speech API — no API key, no cost. Positioned above the on-screen
   keyboard via visualViewport. Unsupported browsers no-op (iPhone users still have the keyboard mic). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  let field = null, rec = null, on = false, btn = null;
  function isField(el) { return !!(el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(|text|search|tel|email|url)$/i.test(el.getAttribute("type") || "text")))); }
  function place() { if (!btn) return; const vv = window.visualViewport; if (vv) { btn.style.top = (vv.offsetTop + vv.height - 66) + "px"; btn.style.bottom = "auto"; } else { btn.style.bottom = "78px"; btn.style.top = "auto"; } }
  function ensure() {
    if (btn) return;
    btn = document.createElement("button"); btn.id = "dictbtn"; btn.type = "button"; btn.title = "Tap to dictate"; btn.setAttribute("aria-label", "Dictate"); btn.innerHTML = "🎤";
    btn.style.cssText = "position:fixed;right:14px;bottom:78px;z-index:9999;width:54px;height:54px;border-radius:50%;border:none;background:var(--accent);color:var(--accent-ink);font-size:25px;box-shadow:0 3px 12px rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;cursor:pointer";
    btn.addEventListener("pointerdown", function (e) { e.preventDefault(); toggle(); });   // preventDefault keeps the field focused
    document.body.appendChild(btn);
  }
  function show() { ensure(); btn.style.display = "flex"; place(); }
  function hide() { if (btn && !on) btn.style.display = "none"; }
  function insert(text) {
    if (!field || !text) return;
    const s = field.selectionStart, e = field.selectionEnd, v = field.value || "";
    if (typeof s === "number") { const pre = v.slice(0, s), sp = pre && !/\s$/.test(pre) ? " " : ""; field.value = pre + sp + text + v.slice(e); const p = s + sp.length + text.length; try { field.setSelectionRange(p, p); } catch (_) { } }
    else field.value = (v && !/\s$/.test(v) ? v + " " : v) + text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function stop() { on = false; if (btn) { btn.innerHTML = "🎤"; btn.style.background = "var(--accent)"; } try { rec && rec.stop(); } catch (_) { } }
  function toggle() {
    if (on) { stop(); return; }
    if (!isField(field)) { const ta = document.querySelector("textarea,input[type=text]"); if (ta) { field = ta; ta.focus(); } }
    if (!field) return;
    rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = function (ev) { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) insert((ev.results[i][0].transcript || "").trim()); };
    rec.onerror = function (ev) { if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) { alert("Microphone is blocked. Allow mic access for this site to dictate."); stop(); } };
    rec.onend = function () { if (on) { try { rec.start(); } catch (_) { stop(); } } };   // keep listening until tapped off
    on = true; show(); btn.innerHTML = "⏹"; btn.style.background = "var(--danger)";
    try { rec.start(); } catch (_) { stop(); }
  }
  document.addEventListener("focusin", function (e) { if (isField(e.target)) { field = e.target; show(); } });
  document.addEventListener("focusout", function () { setTimeout(function () { if (on) return; if (!isField(document.activeElement)) hide(); }, 250); });
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", place); window.visualViewport.addEventListener("scroll", place); }
})();
