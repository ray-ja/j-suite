/* CRO layer — A/B hero, social proof, exit-intent lead capture, click-to-call. Static, no deps. */
(function(){
 var CFG={"tel": "+12525648717", "telDisp": "(252) 564-8717", "accent": "#1B2A4E", "magnet": "home-watch-checklist.html", "exitTitle": "Leaving already?", "exitBody": "Grab our free OBX Home-Watch Checklist \u2014 the exact list we run on every vacant-home visit, inside and out.", "exitCta": "Email me the free checklist"};
 var V=localStorage.getItem('cro_v'); if(V!=='A'&&V!=='B'){V=Math.random()<0.5?'A':'B';localStorage.setItem('cro_v',V);}
 document.documentElement.setAttribute('data-cro',V);
 function ready(fn){if(document.readyState!='loading')fn();else document.addEventListener('DOMContentLoaded',fn);}
 ready(function(){
  // Hero copy lives in the HTML now (single broad residential+commercial tagline) — no A/B text swap.
  // (No fabricated social-proof strip — removed. Real reviews only, when they exist.)
  // Tag every form with the A/B variant for conversion attribution
  document.querySelectorAll('form').forEach(function(f){ if(!f.querySelector('[name="variant"]')){var i=document.createElement('input');i.type='hidden';i.name='variant';i.value=V;f.appendChild(i);} });
  // Exit-intent modal — once per browser session. TRUE exit intent ONLY: the cursor leaves the
  // document through the TOP edge toward the browser chrome (tabs/address bar/close). No timer, no
  // idle, no scroll trigger. Armed after the first pointer movement so it can't fire on page load.
  var fired=sessionStorage.getItem('cro_exit'), armed=false;
  function showExit(){ if(fired||document.querySelector('.cro-ov'))return; fired=1; sessionStorage.setItem('cro_exit','1'); build(); }
  document.addEventListener('mousemove',function(){ armed=true; },{once:true,passive:true});
  document.addEventListener('mouseout',function(e){
    if(!armed) return;
    if(e.relatedTarget) return;                 // moved onto another element, not out of the window
    if((e.clientY||0) <= 0) showExit();          // left via the top edge
  });
  function build(){
   var ov=document.createElement('div');ov.className='cro-ov';
   ov.innerHTML='<div class="cro-modal" role="dialog" aria-modal="true"><button class="cro-x" aria-label="Close">×</button>'+
    '<h3>'+CFG.exitTitle+'</h3><p>'+CFG.exitBody+'</p>'+
    '<form name="lead-magnet" method="POST" action="/lead" class="cro-form">'+
    '<input type="hidden" name="form-name" value="lead-magnet"><input type="hidden" name="magnet" value="'+CFG.magnet+'"><input type="hidden" name="variant" value="'+V+'"><input type="hidden" name="source" value="exit-intent">'+
    '<p style="display:none"><label>skip<input name="bot-field"></label></p>'+
    '<input name="email" type="email" required placeholder="you@email.com" class="cro-inp" aria-label="Email">'+
    '<button class="cro-btn" type="submit">'+CFG.exitCta+'</button></form>'+
    '<a class="cro-call" href="tel:'+CFG.tel+'">📞 or just call '+CFG.telDisp+'</a></div>';
   document.body.appendChild(ov);
   ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
   ov.querySelector('.cro-x').onclick=function(){ov.remove();};
   document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',esc);}});
  }
  var st=document.createElement('style');
  st.textContent='.cro-proof{margin-top:16px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cro-stars{color:#f5b301;letter-spacing:1px}.cro-proof a{text-decoration:underline}'+
   '.cro-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:18px}'+
   '.cro-modal{background:#fff;color:#1a1a1a;max-width:420px;width:100%;border-radius:14px;padding:26px 24px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3)}'+
   '.cro-modal h3{margin:0 0 8px;font-size:1.35rem;color:'+CFG.accent+'}.cro-modal p{margin:0 0 6px;line-height:1.5}'+
   '.cro-x{position:absolute;top:8px;right:14px;border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#999}'+
   '.cro-inp{width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;margin:10px 0;font-size:16px;box-sizing:border-box}'+
   '.cro-btn{width:100%;padding:13px;border:0;border-radius:8px;background:'+CFG.accent+';color:#fff;font-weight:800;font-size:16px;cursor:pointer}'+
   '.cro-call{display:block;text-align:center;margin-top:12px;color:'+CFG.accent+';font-weight:700;text-decoration:none}';
  document.head.appendChild(st);
 });
})();