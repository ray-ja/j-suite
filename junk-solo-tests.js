const fs=require("fs"),vm=require("vm");const src=fs.readFileSync("./js/21-junk-move-out-item-builder-i.js","utf8");
const ctx={window:{},S:{obx:{docs:[]}},D:()=>({properties:[{id:"p",lat:1,lng:1}]}),QE:{TAKE_HOME:45,FIELD_SPLIT:0.48,MILEAGE:0.725,CREW_FLOOR:30},WZ:{cust:{propertyId:"p"}},money:v=>"$"+v,esc:s=>s,console,DRIVE:{roundMiles:20,min:15}};
ctx.driveFromBase=()=>ctx.DRIVE;vm.createContext(ctx);vm.runInContext(src,ctx);
let n=0,f=0;const eq=(a,b,m)=>{n++;if(JSON.stringify(a)!==JSON.stringify(b)){f++;console.log("FAIL",m,a,b);}};
const R=(code)=>vm.runInContext(code,ctx);
eq(R("junkMinFor(1)"),175,"solo min");eq(R('junkMinFor(1,[{key:"fridge",locs:{curbside:1}}])'),175,"solo curbside 175");eq(R('junkMinFor(1,[{key:"fridge",locs:{ground:1}}])'),225,"solo inside 225");eq(R('junkMinFor(2,[{key:"fridge",locs:{ground:1}}])'),285,"crew inside 285");eq(R("junkMinFor(2)"),285,"duo min");eq(R("junkMinFor(5)"),285,"caps at 2");eq(R("JUNK_CREW_MIN"),1,"stepper allows 1");
eq(R("JUNK_FEE.freon"),25,"fridge fee");eq(R("JUNK_FEE.mattress"),50,"mattress fee");
eq(R('junkSoloOK([{key:"fridge",locs:{curbside:2}}])'),{ok:true,why:""},"two curbside fridges = solo OK (Joe)");
eq(R('junkSoloOK([{key:"chair",locs:{ground:4}},{key:"table_sm",locs:{ground:1}}])').ok,true,"patio set at ground = solo");
eq(R('junkSoloOK([{key:"sofa",locs:{upstairs:1}}])').why,"stairs / inside carry","upstairs = crew");
eq(R('junkSoloOK([{key:"sofa",locs:{ground:1},heavy:true}])').ok,false,"heavy flag = crew");
eq(R('junkSoloOK([{key:"hottub",locs:{ground:1}}])').ok,false,"hot tub (600 lb) = crew");
eq(R('junkSoloOK([{key:"gym_smith",locs:{ground:1}}])').ok,false,"teardown = crew");
eq(R('junkSoloOK([{key:"sofa",locs:{ground:5}}])').why,"too much volume for one","150 cuft = crew");
// prices: Joe, two curbside fridges, Corolla
ctx.WZ.junk=[{key:"fridge",locs:{curbside:2}}];ctx.DRIVE={roundMiles:54.6,min:45};
const pj1=R("junkPriceFor(calcJunk(),1)"),pj2=R("junkPriceFor(calcJunk(),2)");
eq([pj1,pj2],[225,300],"Joe: solo $225 / crew $300 (computed, above the floor)");
// close small job
ctx.WZ.junk=[{key:"sofa",locs:{ground:1}},{key:"bag",locs:{ground:4}}];ctx.DRIVE={roundMiles:20,min:15};
eq([R("junkPriceFor(calcJunk(),1)"),R("junkPriceFor(calcJunk(),2)")],[225,285],"close small inside (ground): solo $225 / crew $285");
ctx.WZ.junk=[{key:"sofa",locs:{curbside:1}},{key:"bag",locs:{curbside:4}}];
eq([R("junkPriceFor(calcJunk(),1)"),R("junkPriceFor(calcJunk(),2)")],[175,285],"close small at the curb: $175 / $285");
console.log("=========  "+(n-f)+" passed, "+f+" failed  =========");process.exit(f?1:0);
