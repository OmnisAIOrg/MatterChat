// GUARD: a backtick inside one of these template literals silently terminates the
// string, and the file still type-checks while the CSS is corrupt. This has now
// bitten twice — once on `.rcx-page`, once on `!important`. Fail loudly instead.
import fs from 'fs';
const p = process.argv[2];
const src = fs.readFileSync(p, 'utf8');
let bad = 0, inside = false, lineNo = 0;
for (const line of src.split('\n')) {
	lineNo++;
	if (!inside && /^export const [A-Z_]+ = `/.test(line)) { inside = true; continue; }
	if (inside && /^`;\s*$/.test(line)) { inside = false; continue; }
	if (inside && line.includes('`')) { bad++; console.error(`  ${p}:${lineNo}  stray backtick: ${line.trim().slice(0, 70)}`); }
}
if (bad) { console.error(`\nFAIL: ${bad} stray backtick(s) inside a CSS template literal.`); process.exit(1); }
console.log('ok  no stray backticks inside the CSS template literals');
