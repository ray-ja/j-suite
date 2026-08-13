/* CRO layer — NOTE 2026-08-06: the hero A/B copy override is DISABLED (heroH1/heroLead emptied).
   Ray specified the headline he wants; a coin-flip showing half of visitors different wording defeats
   that, and nothing was reading the results anyway. The fake five-star social-proof strip was removed
   2026-08-06 (no real reviews exist yet). Exit-intent capture and click-to-call promotion still run.
   Original CRO layer — A/B hero, social proof, exit-intent lead capture, click-to-call. Static, no deps. */
(function(){
 var CFG={"tel": "+12522075985", "telDisp": "(252) 207-5985", "accent": "#0099E5", "magnet": "rental-ready-checklist.html", "heroH1": "", "heroLead": "", "exitTitle": "Before you go \u2014", "exitBody": "The free Rental-Ready Tech Checklist covers the setup that stops the guest wifi complaints. Read it on the site, or have it emailed to you.", "exitCta": "Email me the checklist"};
 var V=localStorage.getItem('cro_v'); if(V!=='A'&&V!=='B'){V=Math.random()<0.5?'A':'B';localStorage.setItem('cro_v',V);}
 document.documentElement.setAttribute('data-cro',V);
 function ready(fn){if(document.readyState!='loading')fn();else document.addEventListener('DOMContentLoaded',fn);}
 ready(function(){
  var p=location.pathname;
  var isHome=p==='/'||p===''||/(^|\/)index\.html$/.test(p)||/\/$/.test(p);
  // A/B hero (variant B only, home only)
  if(isHome&&V==='B'){
   var h1=document.querySelector('.hero h1'); if(h1&&CFG.heroH1)h1.textContent=CFG.heroH1;
   var ld=document.querySelector('.hero .lead'); if(ld&&CFG.heroLead)ld.textContent=CFG.heroLead;
   var row=document.querySelector('.hero .cta-row'); // variant B promotes click-to-call to primary
   if(row){var call=row.querySelector('a[href^="tel:"]'); if(call){call.classList.remove('ghost'); var others=row.querySelectorAll('a:not([href^="tel:"])'); others.forEach(function(a){a.classList.add('ghost');}); row.insertBefore(call,row.firstChild);}}
  }
  // Social-proof strip removed 2026-08-06: it injected a five-star rating with zero real reviews
  // behind it. Re-add only once real Google reviews exist, and show the real count.
  // Tag every form with the A/B variant for conversion attribution
  document.querySelectorAll('form').forEach(function(f){ if(!f.querySelector('[name="variant"]')){var i=document.createElement('input');i.type='hidden';i.name='variant';i.value=V;f.appendChild(i);} });
  // Exit-intent / engagement modal (once per browser session)
  var fired=sessionStorage.getItem('cro_exit');
  function showExit(){ if(fired||document.querySelector('.cro-ov'))return; fired=1; sessionStorage.setItem('cro_exit','1'); build(); }
  document.addEventListener('mouseout',function(e){ if(e.clientY<=0&&!e.relatedTarget) showExit(); });
  // 30-second timer removed 2026-08-06: popping a modal at anyone who reads for half a minute
  // punishes exactly the property managers we want. Exit-intent and deep-scroll still trigger it.
  window.addEventListener('scroll',function(){ var d=document.body.scrollHeight-window.innerHeight; if(d>0&&window.scrollY/d>0.85) showExit(); },{passive:true});
  function build(){
   var ov=document.createElement('div');ov.className='cro-ov';
   ov.innerHTML='<div class="cro-modal" role="dialog" aria-modal="true"><button class="cro-x" aria-label="Close">×</button>'+
    '<h3>'+CFG.exitTitle+'</h3><p>'+CFG.exitBody+'</p>'+
    '<form name="lead-magnet" method="POST" action="/lead" class="cro-form">'+
    '<input type="hidden" name="form-name" value="lead-magnet"><input type="hidden" name="magnet" value="'+CFG.magnet+'"><input type="hidden" name="variant" value="'+V+'"><input type="hidden" name="source" value="exit-intent">'+
    '<p style="display:none"><label>skip<input name="bot-field"></label></p>'+
    '<input name="email" type="email" required placeholder="you@email.com" class="cro-inp" aria-label="Email">'+
    '<button class="cro-btn" type="submit">'+CFG.exitCta+'</button></form>'+
    '<a class="cro-call" href="'+CFG.magnet+'">Read it now — no email needed</a>'+
    '<a class="cro-call" href="tel:'+CFG.tel+'">Or just call '+CFG.telDisp+'</a></div>';
   document.body.appendChild(ov);
   ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
   ov.querySelector('.cro-x').onclick=function(){ov.remove();};
   document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',esc);}});
  }
  var st=document.createElement('style');
  st.textContent='.cro-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:18px}'+
   '.cro-modal{background:#fff;color:#1a1a1a;max-width:420px;width:100%;border-radius:14px;padding:26px 24px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3)}'+
   '.cro-modal h3{margin:0 0 8px;font-size:1.35rem;color:'+CFG.accent+'}.cro-modal p{margin:0 0 6px;line-height:1.5}'+
   '.cro-x{position:absolute;top:8px;right:14px;border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#999}'+
   '.cro-inp{width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;margin:10px 0;font-size:16px;box-sizing:border-box}'+
   '.cro-btn{width:100%;padding:13px;border:0;border-radius:8px;background:'+CFG.accent+';color:#fff;font-weight:800;font-size:16px;cursor:pointer}'+
   '.cro-call{display:block;text-align:center;margin-top:12px;color:'+CFG.accent+';font-weight:700;text-decoration:none}';
  document.head.appendChild(st);
 });
})();