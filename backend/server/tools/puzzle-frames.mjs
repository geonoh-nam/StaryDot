// Grabs each puzzle's own frame: the child rebuilds the picture they were just looking at.
//   node backend/server/tools/puzzle-frames.mjs
// Reads frontend/assets/activities.json, writes frontend/assets/puzzles/<video>-<at>.png,
// and rewrites the PUZZLE_IMAGES map in App.js so a new puzzle needs no hand wiring.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const APP = path.join(ROOT, 'frontend/App.js');
const PLANS = path.join(ROOT, 'frontend/assets/activities.json');
const OUT_DIR = path.join(ROOT, 'frontend/assets/puzzles');
const VIDEO_DIR = path.join(ROOT, 'backend/server/media/video');

fs.mkdirSync(OUT_DIR, { recursive: true });
const plans = JSON.parse(fs.readFileSync(PLANS, 'utf8'));
const keys = [];

for (const [videoId, activities] of Object.entries(plans)) {
  for (const a of activities) {
    if (a.type !== 'puzzle') continue;
    const at = a.at_sec ?? a.at;
    const name = `${videoId}-${at}`;
    const file = path.join(OUT_DIR, `${name}.png`);
    const source = path.join(VIDEO_DIR, `${videoId}.mp4`);
    if (!fs.existsSync(source)) {
      console.error(`no video for ${videoId}, skipped`);
      continue;
    }
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', String(at), '-i', source,
      '-frames:v', '1', '-vf', 'scale=940:-1,crop=940:529', file,
    ]);
    a.payload = { ...(a.payload || {}), image: name };
    keys.push(name);
    console.log(`${videoId} ${at}s -> ${name}.png`);
  }
}

fs.writeFileSync(PLANS, JSON.stringify(plans, null, 1));

const map = `const PUZZLE_IMAGES = {\n${keys
  .map((k) => `  '${k}': require('./assets/puzzles/${k}.png'),`)
  .join('\n')}\n};`;
const app = fs.readFileSync(APP, 'utf8').replace(/const PUZZLE_IMAGES = \{[\s\S]*?\n\};/, map);
fs.writeFileSync(APP, app);
console.log(`PUZZLE_IMAGES: ${keys.length}개`);
