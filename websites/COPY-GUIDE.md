# Website copy guide

Ray's rules for every site we build (OBX Junk Co, Milepost Home Watch, Jamieson Automation, Holiday Lights, OBX Lot Solutions). Written 2026-09-11 after the Milepost pass. Read this before writing or editing any page. Every rule below came from a specific correction; the pattern it names has already been removed once.

## The patterns that scream AI

**1. Statement, negation, specifics.** "Every visit ends with a report in your inbox. Not 'everything's fine.' The actual checklist, the actual readings, and photos of anything we flagged." Make the statement and stop. Do not negate a thing nobody said. Do not follow with a list that restates the statement.

**2. "X, not Y."** "A phone call, not just a line in a report." "You'll get an owner, not a call center." "Priced so we can honestly be there, not priced to say yes." "You get told what's true, not what's comfortable." Say X. Delete the "not Y" half. The contrast reads as defensive and invents a villain.

**3. Ending on a negative.** "See trends, not just snapshots." "You pick the rhythm; we hold to it." "Your call, no pressure either way." End the sentence on the positive thing. If the last clause is a disclaimer, cut it.

**4. Em dashes.** None. Not the character, not `&mdash;`, not `--`. Use a period, a comma, a colon, parentheses or a semicolon, and rewrite the sentence so it reads with that punctuation. A run-on with a comma where the dash was is worse than the dash.

**5. The disclaimer paragraph.** "The conclusions belong to you, your insurer and your adjuster. We don't handle claims, and we'll never tell you a report is a substitute for your adjuster's visit." Nobody asked. Delete lawyer-brain prose that pre-argues a dispute.

**6. The "what a real one does" swagger.** "Anyone can say they drove by." "No vague 'we drove by.'" "No mystery pricing." "You hand us your keys; the least we can do is show you our prices." "The difference between a favor and a service." Just state the service.

**7. Emoji and blob icons.** No emoji anywhere on a site. Card icons are fine only as stroke SVGs with `fill:none`; a filled blob "makes it look like AI made it."

**8. Specific-sounding filler.** "Cheap to fix in March and ruinous to find in June." "Within the hour." "Usually within a couple of hours." Specific numbers that aren't real commitments confuse people or become lies.

## Claims we do not make

- No time promises we can't keep: no "within the hour", "same trip", "one day", "within a couple of hours", "as soon as it's safe" (roads close on Hatteras; we can't get there). "Usually within a day" and "the same day" are the only accepted forms, and only where true.
- Nothing about access we can't guarantee ("we're behind the roadblocks").
- No "bonded" (we aren't). No "background-checked" (reads like we hire bottom-of-the-barrel people). No "insured" as a trust badge (Ray: it makes us look less trustworthy). Content about the OWNER's own homeowner policy is fine.
- No "same faces every visit" or "same crew" (we may have employees).
- No "no charge for asking", no "we now take", no "small" in front of concrete.
- No competitor or third-party phone numbers.
- No prices for far-zone or emergency work on the home page; those are quoted by address. Prices live on the plans page only.
- Don't headline what we can't take or won't do. Tell people where a refused item CAN go.
- Don't commit the crew to labor we can't scale ("drains and gutters cleared before the storm" for every client is a week of work in a 48-hour window).
- No services nobody buys ("pre-cool the house before you land").

## What we do say

- Local, family & veteran-owned. This is the trust line. Once per page is plenty; it does not need to be in the header bar, the hero note AND the creds bar.
- Professional handyman on staff (Ray is one). Mention as an option, never as a push.
- Coverage: all services Moyock to Ocracoke plus Carova, priced by address from the shop in Harbinger. Standard rate Harbinger to Duck and down through Nags Head. Access charge only for Carova and Ocracoke.
- Emergency and one-off visits exist. Say that in one sentence; don't list hypothetical reasons someone might call.
- Positive framing of the home. Never describe the customer's house as a problem ("an empty house on the coast is a slow-motion problem").

## Structure and layout

- CTA button text: "Contact us", never "Request a consultation" (sounds like work).
- Closing line on every page: "Or text us at (252) 207-5985 and we reply the same day." with an `sms:` link. No dead "send us a message" links that point at the contact page.
- Top bar: phone number only.
- Every named area gets the same treatment (all 11 town pills carry a map pin, not 7).
- Grids: count the cards. Four cards in a three-column grid orphans one; five in a centered flex bar orphans one. Use `g4`/`g2` or cut an item.
- Service area is its own nav button.
- Check the nav at 1100px after adding a link; six links plus a CTA button clips.

## Process

- Screenshot every change before calling it shipped (desktop and 390px mobile). Headless shell: `chrome-headless-shell --headless --disable-gpu --no-sandbox --window-size=W,H --screenshot=out.png URL`.
- Verify live with `curl` and a cache-buster, then re-fetch once more; the first hit after a deploy is often the stale edge copy.
- Sweep for `&mdash;` entities as well as the `—` character; a revert or a template can bring them back.
- When text sits after an inline SVG (`<p class="note"><svg…/> text</p>`), a plain-string replace on `<p class="note"> text` misses it. Search the text, not the tag.
- Commit before `~/deploy.sh`; it resets tracked files to origin/main.
- Ray reviews live and directs edits. Nothing customer-facing ships as final without his pass.
