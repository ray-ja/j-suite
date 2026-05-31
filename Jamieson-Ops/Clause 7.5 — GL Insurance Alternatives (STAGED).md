# Clause 7.5 (Insurance) — Staged Alternatives

**For:** `Jamieson-Ops/sales/Jamieson - PM Portfolio Agreement.docx` (and the attorney-review draft).
**Status:** STAGED + **CONTRACT FROZEN** — none applied. Per Strategy (2026-05-31): the Jamieson PM Portfolio Agreement does **not** move until Jamieson Automation has its **own** GL policy.
**Prepared:** 2026-05-31 by JS JA Ops.

---

## ⛔ ENTITY GATE — read first

Ray's confirmed GL insurance (Next Insurance, $1M/$1M, eff 2026-06-01) is written to **DYAD Holdings LLC / OBX Lot Solutions ONLY**. **Jamieson Automation is a separate LLC and is NOT covered by that policy.**

So for *this* agreement, the answer is **not** "Ray has GL → Option A." Until Jamieson Automation carries its **own** commercial GL (its own policy, its own COI), clause 7.5 here is **Option B or C — never Option A.** Putting OBX's COI behind a Jamieson contract would misrepresent the covered entity.

**Bottom line: the Jamieson PM Portfolio Agreement is frozen — do not send, sign, or move it — until Jamieson's own GL is bound.**

---

## Why this is staged

The agreement ships today with a placeholder/action flag:

> **7.5. Insurance.** Provider maintains commercial general liability insurance and will provide a certificate of insurance on request. `[ACTION REQUIRED — Ray: keep this clause only if you actually carry commercial general liability insurance; if not, delete this sentence before use.]`

That is a hard fork only Ray can resolve — **misstating insurance coverage in a signed PM contract is a real legal/liability exposure.** A property manager can request the certificate (a COI) on the spot, so the clause has to match reality. Below are the three ready-to-paste versions; Ray picks one, the flag comes out, done.

---

## Option A — Jamieson Automation LLC carries its OWN commercial GL

**Not available yet** — see the Entity Gate above. Use only once Jamieson Automation has bound its own GL policy and can produce a COI in Jamieson's name. (OBX/DYAD's existing Next policy does **not** qualify.) When that's true, this is the strongest version for winning PM/portfolio business (PMs require a COI before letting a vendor on-site).

> **7.5. Insurance.** Provider maintains commercial general liability insurance and will furnish a certificate of insurance (COI) to Client upon request. Provider will name Client as a certificate holder where reasonably requested.

*Optional add if Ray's policy already allows it — many PMs ask for this:*
> Upon written request, Provider will add Client as an additional insured for the duration of active work at Client's properties.

---

## Option B — Jamieson Automation does NOT yet carry its own GL  ← current reality

Do **not** claim coverage Jamieson doesn't have. Replace 7.5 with a neutral clause that states the operating posture without a false representation. **This is the active state until Jamieson's own policy is bound.**

> **7.5. Insurance.** Each Party is responsible for its own insurance. Provider operates as a licensed low-voltage installer and limits its liability as set out in Section 7.4. Certificates of insurance, if required by Client, will be addressed by separate written agreement prior to work commencing.

*Note for Ray:* most OBX property managers require a COI to put a vendor on their approved list — so a **Jamieson-Automation-LLC GL policy** is the real gate to PM/portfolio deals on this side (the OBX/DYAD policy can't be used here). A small low-voltage shop's GL typically runs ~$500–1,500/yr; exact quote varies. Flagging as the growth dependency that unlocks Option A — not advice; get a Jamieson-entity quote.

---

## Option C — GL coverage is in process / bound but COI not in hand

Bridge wording for the gap between buying the policy and having the certificate.

> **7.5. Insurance.** Provider maintains (or is in the process of binding) commercial general liability insurance and will furnish a certificate of insurance to Client upon request once issued. Pending issuance, liability is governed by Section 7.4.

---

## Apply instructions (once Ray picks)

1. JA Ops opens `Jamieson - PM Portfolio Agreement.docx`, replaces the 7.5 paragraph (currently after 7.4 "Limitation of liability", before 7.6 "Independent contractor") with the chosen option's text, and **deletes the `[ACTION REQUIRED …]` bracket**.
2. Same edit in `Jamieson - PM Portfolio Agreement (DRAFT - attorney review).docx`, whose 7.5 currently reads `Provider maintains [general liability] insurance … [Confirm coverage.]` — replace the bracketed bits with the chosen wording so the attorney reviews the real clause.
3. Hand to JS Dev Ops for the git commit. JA Ops does not run git.

❓ASK FOR RZY: Does **Jamieson Automation LLC** carry its **own** GL policy yet (separate from the OBX/DYAD Next policy)? **A** = yes, COI in Jamieson's name → use Option A · **B** = no → stays Option B · **C** = in process → Option C bridge. Default if unanswered: clause 7.5 stays Option B and the **Jamieson PM Portfolio Agreement remains frozen** — does not go out to any PM until Jamieson's own GL is bound.
