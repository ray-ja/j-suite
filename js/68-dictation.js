/* ---------- VOICE DICTATION — free, on-device browser speech-to-text into any text box ----------
   Floating 🎤 → dictate into the focused field; tap ⏹ to stop. Web Speech API (no key, no cost).
   Keeps the screen awake (Wake Lock) while listening, and shows words live (interim results) so you
   don't have to pause for it to write. Positioned above the keyboard via visualViewport. Unsupported
   browsers no-op (the phone keyboard's own mic still works). The start/stop beep is the phone's speech
   earcon — not emitted by this app — but live results mean fewer listen cycles, so fewer beeps. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  let field = null, rec = null, on = false, btn = null, wake = null;
  let before = "", after = "", sp = "";
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
  async function lockScreen() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", function () { wake = null; }); } } catch (_) { } }
  function unlockScreen() { try { wake && wake.release(); } catch (_) { } wake = null; }
  function anchor() {
    const v = field.value || "";
    const s = (typeof field.selectionStart === "number") ? field.selectionStart : v.length;
    const e = (typeof field.selectionEnd === "number") ? field.selectionEnd : s;
    before = v.slice(0, s); after = v.slice(e); sp = (before && !/\s$/.test(before)) ? " " : "";
  }
  function stop() { on = false; unlockScreen(); if (btn) { btn.innerHTML = "🎤"; btn.style.background = "var(--accent)"; } try { rec && rec.stop(); } catch (_) { } }
  function toggle() {
    if (on) { stop(); return; }
    if (!window.isSecureContext) { alert("Voice typing needs a secure (https) connection. On desktop, open the app at its https jsuite.dev address rather than a raw http:// IP."); return; }
    if (!isField(field)) { const ta = document.querySelector("textarea,input[type=text]"); if (ta) { field = ta; ta.focus(); } }
    if (!field) return;
    anchor();
    rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (ev) {
      let txt = ""; for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      txt = txt.replace(/\s+/g, " ").trim();
      field.value = before + sp + txt + after;
      const pos = (before + sp + txt).length; try { field.setSelectionRange(pos, pos); } catch (_) { }
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    rec.onerror = function (ev) { if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) { alert("Microphone is blocked. Allow mic access for this site to dictate."); stop(); } };
    rec.onend = function () {
      if (!on) return;
      // fold what was just dictated into the anchor, then keep listening (continuous)
      if (after && field.value.endsWith(after)) before = field.value.slice(0, field.value.length - after.length); else { before = field.value; after = ""; }
      sp = (before && !/\s$/.test(before)) ? " " : "";
      try { rec.start(); } catch (_) { stop(); }
    };
    on = true; show(); btn.innerHTML = "⏹"; btn.style.background = "var(--danger)"; lockScreen();
    try { rec.start(); } catch (_) { stop(); }
  }
  document.addEventListener("focusin", function (e) { if (isField(e.target)) { field = e.target; show(); } });
  document.addEventListener("focusout", function () { setTimeout(function () { if (on) return; if (!isField(document.activeElement)) hide(); }, 250); });
  document.addEventListener("visibilitychange", function () { if (on && document.visibilityState === "visible") lockScreen(); });   // re-grab the lock if the OS released it
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", place); window.visualViewport.addEventListener("scroll", place); }
})();
