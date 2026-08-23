// Metro resolves imports but never asks whether a name is bound, so a moved component
// only fails on the device. This walks each file's scopes and names the free variables.
//   node scripts/undef-check.js App.js screens/*.js
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const GLOBALS = new Set(['console','require','module','exports','process','setTimeout','clearTimeout','setInterval','clearInterval','Math','JSON','Object','Array','String','Number','Boolean','Date','Promise','Error','Map','Set','RegExp','Symbol','globalThis','global','fetch','__DEV__','undefined','NaN','Infinity','Intl','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','FormData','Blob','URL','AbortController','requestAnimationFrame','cancelAnimationFrame','performance','TextEncoder','Uint8Array','ArrayBuffer','atob','btoa','structuredClone','WeakMap','Proxy','Reflect','queueMicrotask','Uint16Array','Uint32Array','Float32Array','Int32Array','DataView']);
for (const f of process.argv.slice(2)) {
  const code = fs.readFileSync(f, 'utf8');
  let ast;
  try { ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] }); }
  catch (e) { console.log(`${f}: PARSE ${e.message}`); continue; }
  const bad = new Map();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const n = p.node.name;
      if (GLOBALS.has(n) || p.scope.hasBinding(n, true)) return;
      if (!bad.has(n)) bad.set(n, p.node.loc.start.line);
    },
  });
  for (const [n, line] of bad) console.log(`${f}:${line}: undefined '${n}'`);
}
