/* CAP-TODAY PHASE 3 (VOICE) — client assert, run headless via verify-app.js:
 *   node verify-app.js "$(cat cap-voice-tests.js)"
 *
 * Proves, in a real headless browser: the secure-context / feature-detect GATE (by simulating the APIs being
 * absent), the mic HIDDEN + graceful text fallback, and the speak-ONLY-in-voice-mode read-back (by stubbing
 * speechSynthesis and observing speak() calls). Push to window.__errs to FAIL; diag() prints a non-failing line.
 *
 * NOTE: this Chrome build reports a secure context AND ships SpeechRecognition even over file://, so the gate is
 * exercised by explicitly removing the recognition constructors rather than relying on the environment. */

window.alert = function () {}; window.confirm = function () { return true; };
function A(cond, msg) { if (!cond) window.__errs.push("VOICE ASSERT: " + msg); }

// ---- sign in an owner on obx so the Today panel renders with content ----
var vu = { id: "u_voice_test", username: "VoiceTester", active: true };
S.users = S.users || []; S.users.push(vu);
if (typeof orgSetRole === "function") orgSetRole("u_voice_test", "obx", "owner");
localStorage.setItem("jra_session", "u_voice_test");
localStorage.setItem("jra_offline_ok", "1");
S.biz = "obx";

A(typeof capSpeechSupported === "function", "capSpeechSupported not defined");
A(typeof capSynthSupported === "function", "capSynthSupported not defined");
A(typeof window.capMicTap === "function", "capMicTap not defined");
A(typeof window.capToggleReadback === "function", "capToggleReadback not defined");

// ---- 1) WHEN speech IS supported → the mic button + read-back toggle render ----
diag("gate(native): capSpeechSupported=" + capSpeechSupported() + " | isSecureContext=" + window.isSecureContext + " | SpeechRecognition=" + (typeof window.SpeechRecognition) + " | webkit=" + (typeof window.webkitSpeechRecognition));
if (capSpeechSupported()) {
  var supHtml = capTodayPanel();
  A(supHtml.indexOf('id="cap-mic"') >= 0, "mic button should render when speech is supported");
  A(supHtml.indexOf("capMicTap()") >= 0, "mic onclick (capMicTap) missing when supported");
}

// ---- 2) SIMULATE the APIs ABSENT (unsupported browser / insecure) → mic HIDDEN, text fallback + hint ----
var _SR = window.SpeechRecognition, _WSR = window.webkitSpeechRecognition;
try { window.SpeechRecognition = undefined; } catch (e) {}
try { window.webkitSpeechRecognition = undefined; } catch (e) {}
A(capSpeechSupported() === false, "capSpeechSupported() must be false once the recognition constructors are gone");
var offHtml = capTodayPanel();
A(offHtml.indexOf('id="cap-input"') >= 0, "text input must remain when speech is unavailable");
A(offHtml.indexOf("capSend()") >= 0, "Send button must remain when speech is unavailable");
A(offHtml.indexOf('id="cap-mic"') < 0, "MIC BUTTON must be HIDDEN when speech is unavailable (found id=cap-mic)");
A(/Voice needs the app opened via the secure Tailscale link|Voice input isn't supported/.test(offHtml), "a graceful voice hint must show when speech is unavailable");

// render the (mic-less) panel into #view so #cap-input exists, then prove TEXT SEND still works ----
TAB = "today"; render();
var inp = document.getElementById("cap-input");
A(!!inp, "#cap-input not in the DOM after render()");
A(!document.getElementById("cap-mic"), "cap-mic must not be in the DOM (mic hidden when unsupported)");
A(typeof capOnline === "function" && capOnline() === false, "expected offline in headless (deterministic canned reply)");
var before = CAP_THREAD.length;
if (inp) inp.value = "does text still work";
window.capSend();   // typed
A(CAP_THREAD.length > before, "text send must still work with the mic hidden (thread did not grow)");

// ---- stub speechSynthesis + SpeechSynthesisUtterance so read-back is observable ----
var SPOKE = [], CANCELS = 0;
var fakeSynth = { speak: function (u) { SPOKE.push(u && u.text); }, cancel: function () { CANCELS++; } };
try { Object.defineProperty(window, "speechSynthesis", { value: fakeSynth, configurable: true, writable: true }); }
catch (e) { try { window.speechSynthesis = fakeSynth; } catch (e2) {} }
if (typeof window.SpeechSynthesisUtterance !== "function") { window.SpeechSynthesisUtterance = function (t) { this.text = t; }; }
A(capSynthSupported() === true, "capSynthSupported() should be true after stubbing speechSynthesis");
A(capReadbackOn() === true, "read-back should default ON in voice mode");

// ---- 3) TYPED send does NOT speak (Ray: silent when typing) ----
SPOKE.length = 0; CANCELS = 0;
if (inp) inp.value = "what's my day look like";
window.capSend();          // no arg → typed → silent
A(SPOKE.length === 0, "TYPED send must NOT speak (spoke " + SPOKE.length + " time(s))");

// ---- 4) VOICE-initiated send DOES speak Cap's reply, cancelling any in-flight utterance first ----
SPOKE.length = 0; CANCELS = 0;
if (inp) inp.value = "hey cap what's my day";
window.capSend(true);      // voice-initiated → read-back
A(SPOKE.length >= 1, "VOICE send must call speechSynthesis.speak (spoke " + SPOKE.length + " time(s))");
A(SPOKE.length >= 1 && /offline/i.test(SPOKE[0] || ""), "read-back should carry Cap's reply text (got: " + (SPOKE[0] || "") + ")");
A(CANCELS >= 1, "capSpeak must cancel any in-flight utterance before speaking (cancels=" + CANCELS + ")");

// ---- 5) toggle OFF → even a voice send stays silent; persisted; toggle back ON ----
window.capToggleReadback();
A(capReadbackOn() === false, "toggle should flip read-back OFF");
SPOKE.length = 0;
if (inp) inp.value = "again cap";
window.capSend(true);
A(SPOKE.length === 0, "with read-back OFF, even a voice send must not speak (spoke " + SPOKE.length + ")");
window.capToggleReadback();
A(capReadbackOn() === true, "toggle should flip read-back back ON");

// restore native recognition (leave the browser as we found it)
try { window.SpeechRecognition = _SR; window.webkitSpeechRecognition = _WSR; } catch (e) {}

diag("voice: mic-hidden-when-absent=OK | text-send-works=OK | typed-silent=OK | voice-spoke sample=" + JSON.stringify((SPOKE[0] || "n/a").slice(0, 40)));
diag("cap-voice-tests complete — assertions pushed to __errs only on failure");
