// Edit a photo with the image model. usage: node gemini.js <src.jpg|png> <out.png> <prompt.txt> [model]
// Key: org-ai-config.json (lights.imageKey, else _shared.imageKey). Never print it.
const fs=require("fs"),https=require("https"),path=require("path");
const cands=[process.env.AI_CONFIG,path.join(__dirname,"..","..","org-ai-config.json"),"/home/rzy/j-suite/org-ai-config.json"].filter(Boolean);
const c=JSON.parse(fs.readFileSync(cands.find(p=>fs.existsSync(p)),"utf8"));
const key=(c.lights&&c.lights.imageKey)||c._shared.imageKey;
const [src,out,promptFile,model="gemini-3.1-flash-image"]=process.argv.slice(2);
const mime=/\.png$/i.test(src)?"image/png":"image/jpeg";
const payload=JSON.stringify({contents:[{parts:[{inlineData:{mimeType:mime,data:fs.readFileSync(src).toString("base64")}},{text:fs.readFileSync(promptFile,"utf8")}]}],generationConfig:{responseModalities:["IMAGE"]}});
const r=https.request("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(payload)}},resp=>{let d="";resp.on("data",x=>d+=x);resp.on("end",()=>{let j;try{j=JSON.parse(d)}catch(e){console.log("bad",resp.statusCode);process.exit(1)}
 if(j.error){console.log("ERR",resp.statusCode,j.error.message);process.exit(1)}
 const p=((j.candidates||[])[0]||{}).content;const im=((p&&p.parts)||[]).map(x=>x.inlineData||x.inline_data).find(Boolean);
 if(!im){console.log("no image");process.exit(1)}fs.writeFileSync(out,Buffer.from(im.data,"base64"));console.log("saved",out)})});
r.setTimeout(170000,()=>r.destroy(new Error("timeout")));r.on("error",e=>{console.log("neterr",e.message);process.exit(1)});r.write(payload);r.end();
