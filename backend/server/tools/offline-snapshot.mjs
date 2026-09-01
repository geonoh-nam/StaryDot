// Freezes what the tablet needs when no laptop is around: the library it browses and the
// activities the pinned demo episodes ask. Run it with the content server up.
//
//     node backend/server/tools/offline-snapshot.mjs
//
// The media itself is pushed to the pad separately (adb push backend/server/media …).
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = process.env.CONTENT_BASE || 'http://localhost:5056';
const ASSETS = new URL('../../../frontend/assets/', import.meta.url);

// The episodes the demo pins. Their questions must survive with the server off.
const PINNED = ['tayo-타요스페셜3화', 'tayo-타요마법버스1화', 'tayo-타요스페셜1화',
                'teenieping-05', 'teenieping-09', 'teenieping-10'];

const get = async (path) => {
  const r = await fetch(BASE + encodeURI(path));
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};

const library = await get('/library');
writeFileSync(new URL('library.json', ASSETS), JSON.stringify(library, null, 1) + '\n');

// Keep whatever the file already carried — other episodes still fall back to it.
const outPath = new URL('activities.json', ASSETS);
const acts = JSON.parse(readFileSync(outPath, 'utf8'));
for (const id of PINNED) {
  const v = await get(`/videos/${id}`);
  acts[id] = v.activities || [];
}
writeFileSync(outPath, JSON.stringify(acts, null, 1) + '\n');

const counts = PINNED.map((id) => `${id} ${acts[id].length}`).join(' · ');
console.log(`library ${library.length}개 카테고리 · 활동 ${counts}`);
