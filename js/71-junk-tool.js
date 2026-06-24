/* ---------- JUNK ENTRY POINTS → the comprehensive in-wizard item builder (js/21) ----------
   The detailed catalog / search / per-item-access builder lives in the wizard (wizJunkUI, js/21).
   These launchers route every junk entry point — the service picker, the Call Lead quick-pick, the
   demo cross-sell link — into it. (A simpler standalone tool briefly stood in here and was retired in
   favor of the real builder; the $45/hr engine in js/70 will be wired INTO this builder next.) */
window.openJunkBuilder = function () {
  if (typeof WZON === "undefined") return;
  if (!WZON || typeof WZ === "undefined" || !WZ) { if (typeof startWizard === "function") startWizard(); }
  if (typeof WZ === "undefined" || !WZ) return;
  WZ.svc = "junk"; if (!WZ.junk) WZ.junk = [];
  WZON = true; TAB = "quotes";
  if (typeof render2calc === "function") render2calc(); else { WZ.step = "calc"; if (typeof render === "function") render(); }
};
window.openJunkTool = window.openJunkBuilder;   // any lingering reference
window.openJunkEst = window.openJunkBuilder;     // the demo cross-sell link
