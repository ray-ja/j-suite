/* ---------- TAX ESTIMATOR — contractor (1099) self-employment tax set-aside, pure + node-requireable ----------
   Budget v2 PHASE 2. Ray is a 1099 contractor: all his businesses' net flows to ONE 1040 (one taxpayer), so we
   estimate on COMBINED business-book net (income − expenses; transfers excluded). This module is pure math (no DOM),
   node-requireable so sync-server-tests.js can PROVE the numbers. The UI (js/79-budget.js) calls these to drive a
   "Tax set-aside" envelope and a quarterly card.

   THIS IS AN ESTIMATE, NOT TAX FILING. We surface every line (SE / federal / state / child credit) so it's
   transparent and trustworthy, and let Ray OVERRIDE the reserve rate (open-ended — 25% is only a fallback, never
   a floor). His real effective rate is well under 25% because heavy business expenses keep net low and the Child
   Tax Credit ($2,000 × 3 kids) wipes out much of the federal tax. That LOW result is correct — the whole point.

   CONSTANTS = approximate CURRENT-YEAR (2025) figures, kept here as clearly-labeled adjustable knobs. Update once a
   year; they are deliberately easy to find + change. All math in dollars (rounded to cents at the end). */

var TAXY = {
  YEAR: 2025,
  // Self-employment tax (Schedule SE)
  SE_NET_FACTOR: 0.9235,            // SE tax applies to 92.35% of net SE income
  SE_SS_RATE: 0.124,               // Social Security portion (12.4%)
  SE_MED_RATE: 0.029,              // Medicare portion (2.9%, no wage cap)
  SE_SS_WAGE_BASE: 176100,         // 2025 Social Security wage base (SS portion capped here)
  // Federal income tax — MFJ
  FED_STD_DEDUCTION_MFJ: 30000,    // 2025 MFJ standard deduction
  // 2025 MFJ ordinary brackets: [upToTaxableIncome, marginalRate]; last band Infinity
  FED_BRACKETS_MFJ: [
    [23850, 0.10],
    [96950, 0.12],
    [206700, 0.22],
    [394600, 0.24],
    [501050, 0.32],
    [751600, 0.35],
    [Infinity, 0.37]
  ],
  // Child Tax Credit (the simple, non-phaseout case — Ray is well under the MFJ $400k phaseout threshold)
  CHILD_TAX_CREDIT: 2000,          // per qualifying child
  CTC_PHASEOUT_START_MFJ: 400000,  // CTC reduces $50 per $1,000 of AGI over this (Ray is far below — here for completeness)
  // North Carolina — flat tax on (taxable − NC standard deduction)
  NC_RATE: 0.0425,                 // 2025 NC flat individual income tax rate (4.25%)
  NC_STD_DEDUCTION_MFJ: 25500,     // 2025 NC MFJ standard deduction
  FALLBACK_RATE: 0.25              // the operating-agreement 25% reserve — used ONLY as the default before an estimate exists
};

/* tax owed from a progressive bracket table on a taxable amount (dollars) */
function taxFromBrackets(taxable, brackets) {
  taxable = Math.max(0, +taxable || 0);
  var tax = 0, lower = 0;
  for (var i = 0; i < brackets.length; i++) {
    var cap = brackets[i][0], rate = brackets[i][1];
    if (taxable <= lower) break;
    var band = Math.min(taxable, cap) - lower;
    if (band > 0) tax += band * rate;
    lower = cap;
    if (taxable <= cap) break;
  }
  return tax;
}

/* the SE tax on net SE income (dollars), honoring the SS wage-base cap.
   Returns { seTax, netEarnings, deductibleHalf } — deductibleHalf reduces income-taxable income. */
function seTaxOf(netSE, C) {
  C = C || TAXY;
  netSE = Math.max(0, +netSE || 0);
  var netEarnings = netSE * C.SE_NET_FACTOR;                 // 92.35% of net
  var ssTaxable = Math.min(netEarnings, C.SE_SS_WAGE_BASE);   // SS portion is capped at the wage base
  var ss = ssTaxable * C.SE_SS_RATE;
  var med = netEarnings * C.SE_MED_RATE;                      // Medicare uncapped
  var seTax = ss + med;
  return { seTax: seTax, netEarnings: netEarnings, deductibleHalf: seTax / 2 };
}

/* FULL annual estimate from COMBINED business net (dollars) + a tax profile.
   profile: { filing:"mfj", state:"NC", spouseIncome:0, dependents:3, overrideRate:null|number(0..1) }
   Returns a transparent breakdown; `rate` is the EFFECTIVE reserve % of business net, `reserve` the dollars to set aside.
   If overrideRate is a number (0..1) it WINS (open-ended manual control); the computed lines still show for context. */
function estimateAnnualTax(businessNet, profile, C) {
  C = C || TAXY;
  profile = profile || {};
  var net = Math.max(0, +businessNet || 0);
  var spouseIncome = Math.max(0, +profile.spouseIncome || 0);
  var deps = Math.max(0, Math.floor(+profile.dependents || 0));

  // 1) Self-employment tax on the SE net (spouse income is W-2-style, not SE — excluded from SE tax)
  var se = seTaxOf(net, C);

  // 2) Federal income tax (MFJ): taxable = SE net + spouse income − ½ SE tax − std deduction
  var stdDed = C.FED_STD_DEDUCTION_MFJ;
  var grossIncome = net + spouseIncome;
  var agi = grossIncome - se.deductibleHalf;                 // ½ SE tax is an above-the-line deduction
  var fedTaxable = Math.max(0, agi - stdDed);
  var fedBeforeCredits = taxFromBrackets(fedTaxable, C.FED_BRACKETS_MFJ);

  // Child Tax Credit — $2,000/child, phased out $50 per $1,000 of AGI over the MFJ threshold (Ray is far below)
  var ctcFull = deps * C.CHILD_TAX_CREDIT;
  var over = Math.max(0, agi - C.CTC_PHASEOUT_START_MFJ);
  var ctcReduction = Math.ceil(over / 1000) * 50;
  var childCredit = Math.max(0, ctcFull - ctcReduction);
  var fedAfterCredits = Math.max(0, fedBeforeCredits - childCredit);

  // 3) NC state — flat rate on (AGI − NC std deduction). (NC starts from federal AGI; close enough for an estimate.)
  var ncTaxable = Math.max(0, agi - C.NC_STD_DEDUCTION_MFJ);
  var stateTax = ncTaxable * C.NC_RATE;

  // total estimated tax attributable to the business income → the reserve
  var totalTax = se.seTax + fedAfterCredits + stateTax;
  var computedRate = net > 0 ? totalTax / net : 0;

  // manual override wins (open-ended). reserve dollars follow whichever rate is in effect.
  var override = (profile.overrideRate != null && profile.overrideRate !== "" && !isNaN(+profile.overrideRate)) ? Math.max(0, +profile.overrideRate) : null;
  var effectiveRate = override != null ? override : computedRate;
  var reserve = Math.round(net * effectiveRate * 100) / 100;

  return {
    businessNet: Math.round(net * 100) / 100,
    spouseIncome: spouseIncome,
    dependents: deps,
    se: Math.round(se.seTax * 100) / 100,
    seDeductibleHalf: Math.round(se.deductibleHalf * 100) / 100,
    federal: Math.round(fedAfterCredits * 100) / 100,
    federalBeforeCredits: Math.round(fedBeforeCredits * 100) / 100,
    childCredit: Math.round(childCredit * 100) / 100,
    state: Math.round(stateTax * 100) / 100,
    agi: Math.round(agi * 100) / 100,
    fedTaxable: Math.round(fedTaxable * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    computedRate: Math.round(computedRate * 10000) / 10000,   // 4dp (e.g. 0.1834 = 18.34%)
    overrideRate: override,
    effectiveRate: Math.round(effectiveRate * 10000) / 10000,
    reserve: reserve
  };
}

/* quarterly estimated-tax due dates for a given year (IRS 1040-ES schedule). Returns ISO dates. */
function quarterlyDueDates(year) {
  return [
    { label: "Q1", due: year + "-04-15", coversThrough: year + "-03-31" },
    { label: "Q2", due: year + "-06-15", coversThrough: year + "-05-31" },
    { label: "Q3", due: year + "-09-15", coversThrough: year + "-08-31" },
    { label: "Q4", due: (year + 1) + "-01-15", coversThrough: year + "-12-31" }
  ];
}
/* given a date (YYYY-MM-DD), return the NEXT quarterly due date object on/after it (rolls to next year's Q1). */
function nextQuarterlyDue(dateStr) {
  var d = String(dateStr || "");
  var y = parseInt(d.slice(0, 4), 10) || new Date().getFullYear();
  var all = quarterlyDueDates(y).concat(quarterlyDueDates(y + 1));
  for (var i = 0; i < all.length; i++) { if (all[i].due >= d) return all[i]; }
  return all[all.length - 1];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TAXY: TAXY, taxFromBrackets: taxFromBrackets, seTaxOf: seTaxOf,
    estimateAnnualTax: estimateAnnualTax, quarterlyDueDates: quarterlyDueDates, nextQuarterlyDue: nextQuarterlyDue
  };
}
