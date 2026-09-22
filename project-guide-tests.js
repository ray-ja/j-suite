const G = require("./js/183-project-guide.js"); let n = 0, f = 0; const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", m, a, b); } };
const g = { materials: [{ item: "a", price: 10, qty: 2, bought: true }, { item: "b", price: 5.5 }, { item: "c", price: 0 }], steps: [{ text: "x", done: true }, { text: "y" }] };
eq(G.guideProgress(g), { materialsBought: 1, materials: 3, stepsDone: 1, steps: 2, materialsTotal: 25.5 }, "progress counts and total (qty defaults to 1)");
eq(G.guideProgress(null), { materialsBought: 0, materials: 0, stepsDone: 0, steps: 0, materialsTotal: 0 }, "empty guide");
eq(G.guideMoney(1467.82), "$1,467.82", "money format");
eq(G.guideMoney(30), "$30.00", "money format whole");
console.log("=========  " + (n - f) + " passed, " + f + " failed  ========="); process.exit(f ? 1 : 0);
