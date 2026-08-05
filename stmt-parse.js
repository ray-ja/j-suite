#!/usr/bin/env node
"use strict";
/*
 * stmt-parse.js — read Navy Federal "Statement of Account" PDFs into normalised transactions.
 *
 * Ray uploaded 7 monthly statements through the app (js/127). This turns them into rows we can total,
 * categorise and eventually import into his Budget — without him hand-typing anything.
 *
 * FORMAT NOTES (learned from the actual files, not guessed):
 *   - a row is:  MM-DD  <description>   <amount>[ -]   <running balance>
 *   - a TRAILING "-" after the amount means money OUT. No dash means money IN. The dash is separated from
 *     the number by spaces, so a naive parseFloat sees every debit as a credit — this is the single most
 *     important detail in the file.
 *   - descriptions wrap onto the following line(s) ("Themeforge LLC"), which must be joined back on or the
 *     transfers lose the only thing that says which account they came from.
 *   - the statement period ("12/17/25 - 01/16/26") is the only place the YEAR appears; rows carry MM-DD only,
 *     so the year has to be inferred from the period and rolled at the December->January boundary.
 *
 * Read-only: parses and prints. Nothing is written to data.json here.
 *   node stmt-parse.js <file.pdf> [...]     print rows
 *   node stmt-parse.js --json <file.pdf>    machine-readable
 */
const { execFileSync } = require("child_process");
const path = require("path");

function text(pdf) {
  return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 32e6 });
}

/* "12/17/25 - 01/16/26" -> {from:{y,m,d}, to:{y,m,d}} */
function period(t) {
  const m = /(\d{2})\/(\d{2})\/(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/.exec(t);
  if (!m) return null;
  const Y = v => 2000 + +v;
  return { from: { y: Y(m[3]), m: +m[1], d: +m[2] }, to: { y: Y(m[6]), m: +m[4], d: +m[5] } };
}

function parse(pdf) {
  const t = text(pdf);
  const per = period(t);
  const lines = t.split(/\r?\n/);
  const rows = [];
  let cur = null;        // a dated row still waiting for its amount (wrapped description)
  let inDetail = false;  // only capture inside a "Transaction Detail" table
  /* A statement carries MORE THAN ONE ACCOUNT — EveryDay Checking and Membership Savings each get their own
     detail table. Lumping them together made two statements over-count by the savings transfers and dividends.
     Rows are tagged with the account NAME (never the number) so the caller can scope to checking. */
  let account = "";

  const AMT = /([\d,]+\.\d{2})\s*(-?)\s{2,}([\d,]+\.\d{2})\s*$/;   // amount [-]  balance
  const yearFor = (mm) => {
    if (!per) return new Date().getFullYear();
    if (per.from.y === per.to.y) return per.from.y;
    return (mm >= per.from.m) ? per.from.y : per.to.y;      // period straddles a year end
  };
  const flush = () => { if (cur && cur.amount != null) rows.push(cur); cur = null; };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    /* SECTION GATE. "Items Paid" is a two-column RECAP of transactions already listed above — parsing it
       would double-count every ACH and POS in the statement. Capture only inside the detail table. */
    const acctHdr = /^\s*([A-Za-z][A-Za-z ]+?)\s+-\s+\d{6,}/.exec(line);
    if (acctHdr) { flush(); account = acctHdr[1].trim(); }
    if (/Date\s{2,}Transaction Detail/.test(line)) { flush(); inDetail = true; continue; }
    if (/^\s*Items Paid\s*$/.test(line)) { flush(); inDetail = false; continue; }
    if (!inDetail) continue;

    /* balance markers carry no transaction */
    if (/^\s*\d{2}-\d{2}\s+(Beginning|Ending) Balance/.test(line)) { flush(); continue; }

    const dated = /^\s*(\d{2})-(\d{2})\s{2,}(.+)$/.exec(line);
    if (dated) {
      flush();
      const mm = +dated[1], dd = +dated[2];
      let rest = dated[3];
      const a = AMT.exec(rest);
      cur = {
        date: yearFor(mm) + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0"),
        desc: (a ? rest.slice(0, a.index) : rest).trim().replace(/\s{2,}/g, " "),
        amount: a ? +a[1].replace(/,/g, "") : null,
        dir: a ? (a[2] === "-" ? "out" : "in") : null,
        balance: a ? +a[3].replace(/,/g, "") : null,
        account: account
      };
      if (a) flush();        // complete on one line — the common case
      continue;
    }

    /* CONTINUATION. A long description wraps, and the amount + balance land on the NEXT line
       ("… Food Lion #1274 Southern Shor" / "NC        33.53 -    4,421.93"). Missing this is what made
       five of seven statements under-count their debits. */
    if (cur && /^\s{2,}\S/.test(line)) {
      const a = AMT.exec(line);
      if (a) {
        const lead = line.slice(0, a.index).trim();
        if (lead && lead.length < 60) cur.desc += " " + lead;
        cur.amount = +a[1].replace(/,/g, "");
        cur.dir = a[2] === "-" ? "out" : "in";
        cur.balance = +a[3].replace(/,/g, "");
        flush();
      } else {
        const extra = line.trim();
        if (extra && extra.length < 60 && !/^Page \d/.test(extra)) cur.desc += " " + extra;
      }
    }
  }
  flush();

  /* a row can repeat when the table spans a page break */
  const seen = new Set(), out = [];
  for (const r of rows) {
    const k = r.account + "|" + r.date + "|" + r.amount + "|" + r.dir + "|" + r.balance;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return { file: path.basename(pdf), period: per, rows: out };
}

const args = process.argv.slice(2);
const asJson = args.indexOf("--json") >= 0;
const files = args.filter(a => a !== "--json");
if (!files.length) { console.error("usage: node stmt-parse.js [--json] <file.pdf> ..."); process.exit(1); }

const all = files.map(parse);
if (asJson) { console.log(JSON.stringify(all, null, 1)); process.exit(0); }

const money = n => "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
all.forEach(s => {
  const chk = s.rows.filter(r => /Checking/i.test(r.account || ""));
  const inn = chk.filter(r => r.dir === "in").reduce((a, r) => a + r.amount, 0);
  const out = chk.filter(r => r.dir === "out").reduce((a, r) => a + r.amount, 0);
  console.log("\n=== " + s.file + "  " + (s.period ? s.period.from.y + "-" + String(s.period.from.m).padStart(2, "0") : "?") + " ===");
  console.log("  rows " + chk.length + "/" + s.rows.length + "   in " + money(inn) + "   out " + money(out) + "   net " + money(inn - out));
});
