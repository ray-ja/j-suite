#!/usr/bin/env node
"use strict";
/*
 * inbox.js — what Ray has sent me, and where each file actually is on disk.
 *
 * He uploads from his phone (js/127) because he has no access to this workstation. The blobs land in
 * uploads/ with random hex names, which are useless on their own — this joins them back to the record so
 * the label he typed ("NFCU June", "the truck loan") sits next to a real path I can open.
 *
 * Read-only. Marking a file read is a separate, explicit flag (--mark) so nothing changes just by looking.
 *
 *   node inbox.js              list everything, newest first
 *   node inbox.js --new        only what I haven't marked read
 *   node inbox.js --mark <id>  mark one as read (after I've actually read it)
 */
const fs = require("fs"), path = require("path");
const FILE = path.join(__dirname, "data.json");
const UPLOADS = path.join(__dirname, "uploads");
const ORG = process.env.ORG || "mqwvs3mq98pij";

function load() { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
function size(n) { n = +n || 0; return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

const args = process.argv.slice(2);
const markIdx = args.indexOf("--mark");

if (markIdx >= 0) {
  const id = args[markIdx + 1];
  if (!id) { console.error("usage: node inbox.js --mark <recordId>"); process.exit(1); }
  const store = load(), slab = store[ORG] || {};
  const rec = (slab.personalFiles || []).find(f => f && f.id === id);
  if (!rec) { console.error("no such file record: " + id); process.exit(1); }
  rec.readAt = Date.now(); rec.updatedAt = Date.now();
  const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, FILE);
  console.log("marked read: " + (rec.note || rec.name));
  process.exit(0);
}

const onlyNew = args.indexOf("--new") >= 0;
const slab = load()[ORG] || {};
let files = (slab.personalFiles || []).filter(f => f && !f.deleted);
if (onlyNew) files = files.filter(f => !f.readAt);
files.sort((a, b) => (b.ts || 0) - (a.ts || 0));

if (!files.length) { console.log(onlyNew ? "Nothing new." : "No files sent yet."); process.exit(0); }

console.log("\n" + files.length + " file" + (files.length === 1 ? "" : "s") + (onlyNew ? " unread" : "") + ":\n");
let missing = 0;
files.forEach(f => {
  const p = f.blobId ? path.join(UPLOADS, path.basename(f.blobId)) : "";
  const there = p && fs.existsSync(p);
  if (!there) missing++;
  const when = f.ts ? new Date(f.ts).toISOString().slice(0, 16).replace("T", " ") : "?";
  console.log("  " + (f.readAt ? "✓" : "•") + " " + (f.note || "(unlabelled)"));
  console.log("      file " + (f.name || "?") + "  " + size(f.size) + "  sent " + when);
  console.log("      path " + (there ? p : "!! MISSING on disk: " + p));
  console.log("      id   " + f.id);
  console.log("");
});
if (missing) console.log("⚠ " + missing + " record(s) point at a blob that isn't in uploads/ — the upload may have failed.\n");
