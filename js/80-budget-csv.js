/* ---------- BUDGET CSV IMPORT — bring a month of bank/card transactions in from a CSV ----------
   v1 of "bank sync" (Plaid = future). Client-side only, no new deps. Flow, all in one modal:
     1) Source   — paste CSV text OR upload a .csv file.
     2) Map      — pick which column is date / description / amount. Two amount modes:
                   ONE signed column (negative = spending) OR separate Debit + Credit columns.
     3) Review   — preview parsed rows, assign a category per row (dropdown of existing budget
                   categories), with auto-suggest from a merchant-keyword→category memory
                   (budgetMemo, a synced collection) so next import pre-fills known merchants.
                   De-dupe guard skips rows whose date+amount+description already exist (or repeat
                   within the file). Import creates budgetTx records; learned merchants update memo.

   Lives in the Budget tool (js/79) — gated identically (personal template, opt-in budget tab).
   No new collection plumbing here beyond budgetMemo, which is wired into COLLECTIONS/blank()/load(). */

/* ---- a small, dependency-free CSV parser (handles quotes, escaped "" quotes, CRLF) ---- */
function budgetParseCSV(text){
  var rows=[], row=[], field="", i=0, inQ=false, c;
  text=String(text||"").replace(/^﻿/,"");           // strip BOM
  for(i=0;i<text.length;i++){
    c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inQ=false; }
      else field+=c;
    }else{
      if(c==='"')inQ=true;
      else if(c===','){ row.push(field); field=""; }
      else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; }
      else if(c==='\r'){ /* swallow; \n handles the break */ }
      else field+=c;
    }
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  /* drop fully-empty trailing rows */
  return rows.filter(function(r){ return r.some(function(x){return String(x).trim()!=="";}); });
}

/* ---- normalize a description into a stable memory key (merchant-ish keyword) ---- */
function budgetMemoKey(desc){
  var s=String(desc||"").toLowerCase();
  s=s.replace(/[#*].*$/,"");                              // drop trailing ref/auth codes after # or *
  s=s.replace(/\b\d[\d.\-\/]*\b/g," ");                   // drop numbers (dates, amounts, ids)
  s=s.replace(/[^a-z ]+/g," ").replace(/\s+/g," ").trim();
  return s.split(" ").slice(0,3).join(" ");              // first ~3 words = the merchant signature
}
function budgetMemoLookup(desc){
  var key=budgetMemoKey(desc); if(!key)return "";
  var hit=actBudgetMemo().find(function(m){return m.key===key;});
  if(hit&&budgetCat(hit.catId))return hit.catId;
  /* fallback: a memo key contained in this description (looser match) */
  var loose=actBudgetMemo().find(function(m){return m.key&&key.indexOf(m.key)===0&&budgetCat(m.catId);});
  return loose?loose.catId:"";
}
function budgetMemoRemember(desc,catId){
  if(!catId||!budgetCat(catId))return;
  var key=budgetMemoKey(desc); if(!key)return;
  var d=D(); if(!d.budgetMemo)d.budgetMemo=[];
  var m=d.budgetMemo.find(function(x){return x.key===key&&!x.deleted;});
  if(m){ if(m.catId!==catId){ m.catId=catId; touch(m); } }
  else d.budgetMemo.push(touch({id:"bgt-memo-"+uid(),key:key,catId:catId,deleted:false}));
}

/* ---- parse a date cell into YYYY-MM-DD (accepts ISO, M/D/Y, M-D-Y, D/M/Y is ambiguous→assume US) ---- */
function budgetParseDate(s){
  s=String(s||"").trim(); if(!s)return "";
  var iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso)return iso[1]+"-"+pad2(iso[2])+"-"+pad2(iso[3]);
  var us=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(us){ var y=us[3]; if(y.length===2)y="20"+y; return y+"-"+pad2(us[1])+"-"+pad2(us[2]); }
  var d=new Date(s); if(!isNaN(d))return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
  return "";
}
function pad2(n){ return String(n).padStart(2,"0"); }
/* "$1,234.56" / "(12.34)" / "-12.34" → number */
function budgetParseAmount(s){
  s=String(s==null?"":s).trim(); if(!s)return null;
  var neg=/^\(.*\)$/.test(s)||/-/.test(s);
  s=s.replace(/[()]/g,"").replace(/[^0-9.]/g,"");
  if(s==="")return null;
  var n=parseFloat(s); if(isNaN(n))return null;
  return neg?-Math.abs(n):n;
}

/* ---- import session state ---- */
var BCSV=null;   // {rows, headers, hasHeader, map, amtMode, parsed}

window.budgetImportOpen=function(){
  /* land imported rows in the currently-selected book (or the default Personal book when Combined is on) */
  var bookId=(typeof budgetDefaultBookId==="function")?budgetDefaultBookId():"";
  BCSV={ rows:null, headers:[], hasHeader:true, map:{date:0,desc:1,amount:2,debit:-1,credit:-1}, amtMode:"signed", parsed:[], bookId:bookId };
  budgetImportStep1();
};

/* ---------- STEP 1 — source (paste or upload) ---------- */
function budgetImportStep1(){
  var books=(typeof actBudgetBooks==="function")?actBudgetBooks():[];
  if(!BCSV.bookId||!books.find(function(b){return b.id===BCSV.bookId;}))BCSV.bookId=books.length?books[0].id:"";
  var bookSel=books.length>1?('<label>Import into book</label><select id="bcsv_book" onchange="budgetCsvBookChange(this.value)">'
    +books.map(function(b){return '<option value="'+b.id+'"'+(BCSV.bookId===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select>')
    :(books.length?'<div class="sub" style="margin-bottom:6px">Importing into <b>'+esc(books[0].name)+'</b>.</div>':'');
  modal("Import CSV — 1 of 3: source",''
    +'<p class="muted" style="margin:0 0 8px;font-size:13px">Paste your bank/card CSV below, or choose a file. We parse it on your phone — nothing is uploaded.</p>'
    +bookSel
    +'<input type="file" id="bcsv_file" accept=".csv,text/csv" style="margin-bottom:8px" onchange="budgetCsvFile(this)">'
    +'<label>or paste CSV</label>'
    +'<textarea id="bcsv_text" rows="7" placeholder="Date,Description,Amount\n2026-06-01,COFFEE SHOP,-4.50\n..." style="width:100%;font-family:monospace;font-size:12px"></textarea>'
    +'<button class="btn acc" style="margin-top:12px" onclick="budgetCsvParse()">Next: map columns →</button>'
  );
};
window.budgetCsvBookChange=function(id){ if(BCSV)BCSV.bookId=id; };
window.budgetCsvFile=function(input){
  var f=input&&input.files&&input.files[0]; if(!f)return;
  var rdr=new FileReader();
  rdr.onload=function(){ var ta=document.getElementById("bcsv_text"); if(ta)ta.value=rdr.result; };
  rdr.onerror=function(){ alert("Could not read that file."); };
  rdr.readAsText(f);
};
window.budgetCsvParse=function(){
  var bsel=document.getElementById("bcsv_book"); if(bsel)BCSV.bookId=bsel.value;
  var text=(document.getElementById("bcsv_text")||{}).value||"";
  var rows=budgetParseCSV(text);
  if(rows.length<1){ alert("No rows found. Paste a CSV or choose a file first."); return; }
  BCSV.rows=rows;
  /* guess header: first row has no parseable amount in any cell → it's a header */
  var first=rows[0];
  BCSV.hasHeader=!first.some(function(c){ return budgetParseAmount(c)!=null && /\d/.test(c); });
  BCSV.headers=BCSV.hasHeader?first.map(function(h,i){return String(h).trim()||("Column "+(i+1));}):first.map(function(_,i){return "Column "+(i+1);});
  /* best-guess column mapping by header name */
  var idxBy=function(re){ return BCSV.headers.findIndex(function(h){return re.test(h.toLowerCase());}); };
  var di=idxBy(/date|posted/), pi=idxBy(/desc|name|memo|payee|merchant/),
      ai=idxBy(/amount|amt/), dbi=idxBy(/debit|withdraw/), cri=idxBy(/credit|deposit/);
  BCSV.map={ date:di>=0?di:0, desc:pi>=0?pi:1, amount:ai>=0?ai:2, debit:dbi, credit:cri };
  BCSV.amtMode=(dbi>=0&&cri>=0)?"split":"signed";
  budgetImportStep2();
};

/* ---------- STEP 2 — map columns ---------- */
function budgetImportStep2(){
  var cols=BCSV.headers;
  var sel=function(id,cur,allowNone){
    return '<select id="'+id+'" onchange="budgetCsvMapChange()">'
      +(allowNone?'<option value="-1"'+(cur<0?" selected":"")+'>— none —</option>':'')
      +cols.map(function(h,i){return '<option value="'+i+'"'+(cur===i?" selected":"")+'>'+esc(h)+'</option>';}).join("")
      +'</select>';
  };
  var nRows=BCSV.rows.length-(BCSV.hasHeader?1:0);
  var h='<p class="muted" style="margin:0 0 8px;font-size:13px">'+nRows+' data row'+(nRows===1?"":"s")+'. Tell us which column is which.</p>'
    +'<label>Date column</label>'+sel("bcsv_date",BCSV.map.date,false)
    +'<label>Description column</label>'+sel("bcsv_desc",BCSV.map.desc,false)
    +'<label style="margin-top:10px">Amount format</label>'
    +'<div class="row" style="gap:8px;margin-bottom:6px">'
    +'<button class="btn '+(BCSV.amtMode==="signed"?"acc":"ghost")+'" style="flex:1" onclick="budgetCsvAmtMode(\'signed\')">One signed column</button>'
    +'<button class="btn '+(BCSV.amtMode==="split"?"acc":"ghost")+'" style="flex:1" onclick="budgetCsvAmtMode(\'split\')">Debit + Credit</button>'
    +'</div>';
  if(BCSV.amtMode==="signed"){
    h+='<label>Amount column</label>'+sel("bcsv_amount",BCSV.map.amount,false)
      +'<div class="sub" style="margin:4px 0">Negative amounts = spending, positive = income.</div>';
  }else{
    h+='<label>Debit (spending) column</label>'+sel("bcsv_debit",BCSV.map.debit,true)
      +'<label>Credit (income) column</label>'+sel("bcsv_credit",BCSV.map.credit,true)
      +'<div class="sub" style="margin:4px 0">A row with a debit = spending; a credit = income.</div>';
  }
  h+='<label class="row" style="gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="bcsv_hdr" '+(BCSV.hasHeader?"checked":"")+' onchange="budgetCsvMapChange()" style="width:auto"> First row is a header</label>';
  h+='<div class="row" style="gap:8px;margin-top:12px"><button class="btn ghost" style="flex:1" onclick="budgetImportStep1()">← Back</button>'
    +'<button class="btn acc" style="flex:2" onclick="budgetCsvBuild()">Next: review →</button></div>';
  modal("Import CSV — 2 of 3: map columns",h);
};
window.budgetCsvAmtMode=function(mode){ budgetCsvMapChange(); BCSV.amtMode=mode; budgetImportStep2(); };
window.budgetCsvMapChange=function(){
  var gv=function(id){ var e=document.getElementById(id); return e?parseInt(e.value,10):undefined; };
  if(document.getElementById("bcsv_date"))BCSV.map.date=gv("bcsv_date");
  if(document.getElementById("bcsv_desc"))BCSV.map.desc=gv("bcsv_desc");
  if(document.getElementById("bcsv_amount"))BCSV.map.amount=gv("bcsv_amount");
  if(document.getElementById("bcsv_debit"))BCSV.map.debit=gv("bcsv_debit");
  if(document.getElementById("bcsv_credit"))BCSV.map.credit=gv("bcsv_credit");
  var hdr=document.getElementById("bcsv_hdr"); if(hdr)BCSV.hasHeader=hdr.checked;
};

/* ---------- build parsed rows from the mapping, then go to review ---------- */
window.budgetCsvBuild=function(){
  budgetCsvMapChange();
  var data=BCSV.rows.slice(BCSV.hasHeader?1:0);
  var m=BCSV.map, parsed=[], seen={};
  /* existing tx for de-dupe: date|amount|desc-ish — scoped to the TARGET book so the same row can live in two books */
  var existing={};
  (D().budgetTx||[]).filter(function(t){return !t.deleted&&!t.isTransfer&&t.bookId===BCSV.bookId;})
    .forEach(function(t){ existing[budgetDupKey(t.date,t.amount,t.note)]=true; });
  data.forEach(function(r){
    var date=budgetParseDate(r[m.date]);
    var desc=String(r[m.desc]!=null?r[m.desc]:"").trim();
    var amt,dir;
    if(BCSV.amtMode==="signed"){
      var n=budgetParseAmount(r[m.amount]);
      if(n==null)return;
      dir=n<0?"out":"in"; amt=Math.abs(n);
    }else{
      var dv=m.debit>=0?budgetParseAmount(r[m.debit]):null;
      var cv=m.credit>=0?budgetParseAmount(r[m.credit]):null;
      if(dv!=null&&dv!==0){ dir="out"; amt=Math.abs(dv); }
      else if(cv!=null&&cv!==0){ dir="in"; amt=Math.abs(cv); }
      else return;
    }
    if(!amt||amt<=0)return;
    if(!date)date=today();
    var dk=budgetDupKey(date,amt,desc);
    var dup=existing[dk]||seen[dk];   // already in book OR repeated within this file
    seen[dk]=true;
    /* pre-fill a remembered category only if it lives in the target book (cats are book-scoped) */
    var mc=budgetMemoLookup(desc), mcc=mc?budgetCat(mc):null;
    parsed.push({ date:date, desc:desc, amount:Math.round(amt*100)/100, dir:dir,
                  catId:(mcc&&mcc.bookId===BCSV.bookId)?mc:"", dup:dup, skip:dup });
  });
  if(!parsed.length){ alert("No transactions could be parsed with this mapping. Check the column choices and amount format."); return; }
  BCSV.parsed=parsed;
  budgetImportStep3();
};
function budgetDupKey(date,amount,desc){
  return String(date||"")+"|"+(Math.round((+amount||0)*100))+"|"+budgetMemoKey(desc);
}

/* ---------- STEP 3 — review + categorize ---------- */
function budgetImportStep3(){
  /* categories of the TARGET book (not the on-screen filter) so picks pair with the book we import into */
  var cats=(D().budgetCats||[]).filter(function(c){return !c.deleted&&c.bookId===BCSV.bookId;})
    .sort(function(a,b){ return (a.order||0)-(b.order||0)||(a.name||"").localeCompare(b.name||""); });
  var bk=(typeof budgetBookName==="function")?budgetBookName(BCSV.bookId):"";
  var p=BCSV.parsed;
  var nNew=p.filter(function(x){return !x.skip;}).length;
  var nDup=p.filter(function(x){return x.dup;}).length;
  var catOpts=function(rowCatId,kind){
    return '<option value="">— uncategorized —</option>'+cats.filter(function(c){return (c.kind||"out")===kind;}).map(function(c){
      return '<option value="'+c.id+'"'+(rowCatId===c.id?" selected":"")+'>'+esc(c.name)+'</option>';
    }).join("");
  };
  var h='<p class="muted" style="margin:0 0 6px;font-size:13px">'+nNew+' to import'+(nDup?', '+nDup+' likely duplicate'+(nDup===1?"":"s")+' (unchecked)':'')
    +'. Set a category per row — known merchants are pre-filled. '+(cats.length?'':'No categories yet; add some on Settings first to categorize.')+'</p>';
  if(!cats.length){
    h+='<div class="sub" style="margin-bottom:8px">You can still import as uncategorized and categorize later.</div>';
  }
  h+='<div style="max-height:46vh;overflow:auto;border:1px solid var(--line,#eee);border-radius:8px">';
  h+=p.map(function(row,i){
    var inc=row.dir==="in";
    return '<div class="li" style="align-items:flex-start;gap:6px;'+(row.dup?"opacity:.7;":"")+'border-bottom:1px solid var(--line,#f0f0f0);padding:6px 8px">'
      +'<input type="checkbox" id="bcsv_keep_'+i+'" '+(row.skip?"":"checked")+' onchange="budgetCsvToggle('+i+')" style="width:auto;margin-top:4px">'
      +'<div class="grow" style="min-width:0">'
      +'<div class="nm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(row.desc||"(no description)")+(row.dup?' <span class="sub" style="color:var(--danger)">dup</span>':'')+'</div>'
      +'<div class="sub">'+esc(fmtDate(row.date))+' · <b style="color:'+(inc?"var(--ok,#1b7f4d)":"var(--danger)")+'">'+(inc?"+":"−")+budgetMoney(row.amount)+'</b></div>'
      +'<select id="bcsv_cat_'+i+'" onchange="budgetCsvSetCat('+i+')" style="margin-top:4px;width:100%">'+catOpts(row.catId,row.dir)+'</select>'
      +'</div></div>';
  }).join("");
  h+='</div>';
  h+='<div class="row" style="gap:8px;margin-top:12px"><button class="btn ghost" style="flex:1" onclick="budgetImportStep2()">← Back</button>'
    +'<button class="btn acc" style="flex:2" onclick="budgetCsvCommit()">Import '+nNew+' transaction'+(nNew===1?"":"s")+'</button></div>';
  modal("Import CSV — 3 of 3: review",h);
};
window.budgetCsvToggle=function(i){
  var cb=document.getElementById("bcsv_keep_"+i); if(cb)BCSV.parsed[i].skip=!cb.checked;
};
window.budgetCsvSetCat=function(i){
  var s=document.getElementById("bcsv_cat_"+i); if(s)BCSV.parsed[i].catId=s.value;
};

/* ---------- commit — create budgetTx records + learn merchants ---------- */
window.budgetCsvCommit=function(){
  /* sync UI state for all rows (checkboxes/selects) before committing */
  BCSV.parsed.forEach(function(row,i){
    var cb=document.getElementById("bcsv_keep_"+i); if(cb)row.skip=!cb.checked;
    var s=document.getElementById("bcsv_cat_"+i); if(s)row.catId=s.value;
  });
  var keep=BCSV.parsed.filter(function(r){return !r.skip;});
  if(!keep.length){ alert("Nothing selected to import."); return; }
  var bookId=BCSV.bookId||(typeof budgetDefaultBookId==="function"?budgetDefaultBookId():"");
  var lastMonth=budgetThisMonth();
  keep.forEach(function(row){ lastMonth=budgetMonthOf(row.date); });

  /* ⭐ IMPORT NO LONGER POSTS. Ray, 2026-08-25: "everything needs approvals. like ynab." This used to
     write straight into budgetTx — which meant a CSV silently moved every envelope the moment it was
     read. Now it hands the rows to the ledger (js/143), they land PENDING, and they are in no total
     anywhere until he approves them on the Review tab. One door in, so a bank feed lands the same way. */
  var res=(typeof ledgerIngest==="function")
    ? ledgerIngest(keep.map(function(row){ return {date:row.date,dir:row.dir,amount:row.amount,desc:row.desc||"",bookId:bookId}; }),
                   {source:"csv",bookId:bookId})
    : {added:0,duplicates:0};
  closeModal();
  BUDGET_SUB=res.added?"review":"tx"; BUDGET_MONTH=lastMonth; if(bookId)BUDGET_BOOK=bookId; BCSV=null;
  render();
  if(typeof toast==="function")toast(res.added+" to review"+(res.duplicates?(" · "+res.duplicates+" already here"):""));
};
