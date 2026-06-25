// Convert a "story/sentences" lyrics transcript into a Reel Creator project JSON.
//
// Source shape (per sentence): { id, devanagari, transliteration, english, tokens[] }
// Reel Creator line shape:      { id, original, translation?, start? }
//
// The source has THREE text layers (devanagari / transliteration / english) but a
// Reel Creator line shows only two: `original` (top) and `translation` (below).
// Choose which source layer maps to each with --original / --translation.
//
// Usage:
//   node scripts/convert-story-lyrics.mjs <input.json> <output.json> \
//        [--original devanagari|transliteration|english] \
//        [--translation english|transliteration|devanagari|none] \
//        [--title "Song"] [--artist "Artist"]
//
// Defaults: --original devanagari  --translation english
//
// Notes:
//  - Word-level `tokens` are dropped (v1 timing is line-level).
//  - No `start` times are written; you tap-to-time each line in the editor.
//  - Repairs Latin-1/UTF-8 "mojibake" (e.g. "à¤à¤") if a mis-encoded file is passed.

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const [input, output] = positional;
if (!input || !output) {
  console.error('Usage: node scripts/convert-story-lyrics.mjs <input.json> <output.json> [--original ...] [--translation ...] [--title ...] [--artist ...]');
  process.exit(1);
}

const originalKey = flag('original', 'devanagari');
const translationKey = flag('translation', 'english');
const title = flag('title', null);
const artist = flag('artist', null);

// Repair text that was decoded as Latin-1 but is really UTF-8 ("Ã"/"à¤" mojibake).
function fixMojibake(s) {
  if (typeof s !== 'string' || !/[À-ÿ]¤|Ã[-¿]/.test(s)) return s;
  try {
    const repaired = Buffer.from(s, 'latin1').toString('utf8');
    return repaired.includes('�') ? s : repaired;
  } catch {
    return s;
  }
}

const src = JSON.parse(readFileSync(input, 'utf8'));
const sentences = Array.isArray(src.sentences) ? src.sentences : [];

const lines = sentences.map((s) => {
  const line = { original: fixMojibake(s[originalKey] ?? '') };
  if (translationKey !== 'none') {
    const t = fixMojibake(s[translationKey] ?? '');
    if (t) line.translation = t;
  }
  // `start` intentionally omitted — set it in the timing editor.
  return line;
});

const project = {
  version: 1,
  meta: {
    title: title ?? fixMojibake(src.story?.title?.transliteration ?? ''),
    artist: artist ?? '',
  },
  audio: { name: '', duration: 0, startOffset: 0, endOffset: null },
  lines,
};

writeFileSync(output, JSON.stringify(project, null, 2) + '\n', 'utf8');
console.log(`Wrote ${lines.length} lines -> ${output}`);
console.log(`  original   <- ${originalKey}`);
console.log(`  translation<- ${translationKey}`);
