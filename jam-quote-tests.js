/* jam-quote-tests.js — the Jamieson (jam org) automation quote system: the deep engine surfaces the automation
   categories for jam, and the new Rental-Ready per-door builder multiplies a per-door package × the door count.
   Run: node verify-app.js "$(cat jam-quote-tests.js)" */
window.alert = function () {}; window.confirm = function () { return true; };
S.biz = "jam";
function T(n, c) { if (c) diag("✓ " + n); else __errs.push("JAMQUOTE FAIL: " + n); }

// 1) the jam org's quote category list leads with Rental-Ready, then the automation builders
T("jam wizard categories exist", typeof WZ_SVC !== "undefined" && Array.isArray(WZ_SVC.jam));
T("jam leads with Rental-Ready (per door)", WZ_SVC.jam[0][0] === "rental");
["lock", "camera", "network", "starlink"].forEach(k =>
  T("jam has the '" + k + "' automation quote builder", WZ_SVC.jam.some(x => x[0] === k)));

// 2) the deep engine has the automation categories with real pricing
T("DEEP has lock/camera/network/starlink/rental", ["lock", "camera", "network", "starlink", "rental"].every(k => DEEP[k]));

// 3) Rental-Ready per-door math: one price per door × N doors
WZ = { svc: "rental", deep: { rental: [{ key: "std", qty: 10, mod: null }] }, deepMods: {} };
let c = calcDeep("rental");
T("10 doors × Standard ($999) = $9,990", Math.round(c.sub) === 9990);
T("quote produces one itemized row", c.rows.length === 1);

// 4) add-ons stack: Starlink per property + extra cameras per door
WZ.deep.rental.push({ key: "star", qty: 1 }, { key: "cam", qty: 5 });
c = calcDeep("rental");
T("Standard×10 + Starlink($349) + 5 cameras($300) = $11,839", Math.round(c.sub) === 11839);

// 5) Essential vs Premium tiers price per door correctly
WZ = { svc: "rental", deep: { rental: [{ key: "ess", qty: 4 }] }, deepMods: {} };
T("4 doors × Essential ($599) = $2,396", Math.round(calcDeep("rental").sub) === 2396);
WZ.deep.rental = [{ key: "prem", qty: 4 }];
T("4 doors × Premium ($1,599) = $6,396", Math.round(calcDeep("rental").sub) === 6396);

// 6) a real automation builder still works (Starlink roof mount + mesh)
WZ = { svc: "starlink", deep: { starlink: [{ key: "roof", qty: 1 }, { key: "mesh", qty: 1 }] }, deepMods: {} };
T("Starlink roof ($449) + mesh ($149) = $598", Math.round(calcDeep("starlink").sub) === 598);

diag("jam-quote: automation quote system + Rental-Ready per-door builder OK");
