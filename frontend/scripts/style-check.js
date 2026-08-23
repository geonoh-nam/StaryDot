// A style that is referenced but never defined is silently ignored by React Native, so a
// mislaid StyleSheet entry shows up as a layout glitch rather than an error. This names them.
//   node scripts/style-check.js App.js screens/*.js
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8');
  const sheet = s.split('StyleSheet.create(')[1] || '';
  const defined = new Set([...sheet.matchAll(/\n  ([a-zA-Z][a-zA-Z0-9]*): \{/g)].map((m) => m[1]));
  const missing = new Set();
  for (const m of s.matchAll(/\bstyles\.([a-zA-Z][a-zA-Z0-9]*)/g)) if (!defined.has(m[1])) missing.add(m[1]);
  for (const n of missing) console.log(`${f}: styles.${n} is used but never defined`);
}
