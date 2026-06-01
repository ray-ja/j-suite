/* ---------- REVIEW REQUEST (get Google reviews) ---------- */
window.reviewAsk=function(){
  const dc=S.obx.docs.find(x=>x.id==="reviewlink"&&!x.deleted);const link=dc?dc.text:"";
  const msg="Hi [name], thank you for trusting OBX Lot Solutions today! If you were happy with the work, the biggest help for our small local business is a quick Google review — it takes about 20 seconds: "+(link||"[your review link]")+" \n\nThank you so much! — [your name]";
  modal("Ask for a Google review",`
    <p class="muted" style="margin:0 0 8px">Right after a happy job, while you're standing there, send this. Reviews are what make OBX Lot Solutions show up on Google.</p>
    <label>Your Google review link</label>
    <input id="rv_link" value="${esc(link)}" placeholder="Paste your Google review short link (g.page/r/...)">
    <p class="sub" style="margin:4px 0 0">Get it once: open your Google Business Profile → Ask for reviews / Get more reviews → copy the short link. Save it here and it auto-fills the message.</p>
    <button class="btn ghost sm" style="margin-top:8px" onclick="saveReviewLink()">Save link</button>
    <label style="margin-top:14px">Message to send the customer</label>
    <textarea id="rv_msg" style="min-height:130px">${esc(msg)}</textarea>
    <button class="btn acc" style="margin-top:10px" onclick="copyReview()">Copy message</button>
    <p class="sub" style="margin-top:8px">Swap in their name and yours, then paste into a text or email. Ask in person first, then send the link — that combo gets the most reviews.</p>`);
};
window.saveReviewLink=function(){const v=val("rv_link");let dc=S.obx.docs.find(x=>x.id==="reviewlink");if(dc){dc.text=v;dc.deleted=false;dc.updatedAt=now();}else S.obx.docs.push({id:"reviewlink",text:v,updatedAt:now()});save();alert("Saved. Reopen this tool and your link will auto-fill the message.");};
window.copyReview=function(){const t=document.getElementById("rv_msg");if(!t)return;t.select();try{document.execCommand("copy");alert("Copied — paste it into a text to your customer.");}catch(e){alert("Select the message text and copy it manually.");}};

