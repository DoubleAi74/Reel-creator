import { EditorShell } from "@/components/editor-shell";
import { createDefaultProject } from "@/lib/project";

/*
 * ============================================================================
 * DORMANT REFERENCE CODE — NOT CURRENTLY USED
 * ============================================================================
 * The helpers below (`tokenize`, `buildSampleWords`, `createReferenceSampleProject`)
 * used to build a hard-coded "Aaj Se Teri" sample project that was rendered on
 * the home page. The sample data (`@/samples/aaj-se-teri.json`) and the
 * `WORD_BANK` Hindi->{gloss,roman} dictionary they relied on have been removed,
 * so this code does NOT run anymore. `Home()` now boots a fully blank project.
 *
 * They are intentionally kept (commented out) for future reference — e.g. if a
 * built-in demo song is reintroduced. To revive them you would need to:
 *   - restore/inline a draft JSON source (formerly `sampleDraft`), and
 *   - restore a `WORD_BANK` dictionary, or rewire `buildSampleWords` to use the
 *     AI word-meanings flow instead (see lib/word-board.js).
 *
 * NOTE: the real, app-wide implementations of these concepts already live
 * elsewhere and are unaffected:
 *   - `tokenize`        -> lib/word-board.js
 *   - per-word meanings -> /api/ai/word-meanings (no hard-coded dictionary)
 * ----------------------------------------------------------------------------
 *
 * // --- tokenize -------------------------------------------------------------
 * // Strips punctuation and splits a string into an array of words.
 * // (Duplicate of the canonical helper in lib/word-board.js; was used only by
 * // buildSampleWords below.)
 * function tokenize(value) {
 *   return String(value ?? "")
 *     .replace(/[.,!?;:()]/g, "")
 *     .split(/\s+/)
 *     .filter(Boolean);
 * }
 *
 * // --- buildSampleWords -----------------------------------------------------
 * // For one lyric line, tokenizes the original text and produces a words[]
 * // array of { text, gloss, roman }. It looked up each word in WORD_BANK (now
 * // deleted) for gloss/roman, falling back to the matching translation token.
 * // Used only by createReferenceSampleProject.
 * function buildSampleWords(line) {
 *   const translationTokens = tokenize(line.translation);
 *
 *   return tokenize(line.original).map((text, wordIndex) => {
 *     const known = WORD_BANK[text];
 *
 *     return {
 *       gloss: known?.gloss ?? translationTokens[wordIndex] ?? "",
 *       roman: known?.roman ?? text,
 *       text,
 *     };
 *   });
 * }
 *
 * // --- createReferenceSampleProject -----------------------------------------
 * // Built the entire on-load sample project: read the (now deleted) sampleDraft
 * // JSON, blanked the meta, hard-coded the Aaj-Se-Teri mp3 as audio, and mapped
 * // each draft line adding an id, a fabricated start time, and per-word data via
 * // buildSampleWords.
 * function createReferenceSampleProject() {
 *   return createDefaultProject({
 *     ...sampleDraft,
 *     meta: {
 *       artist: "",
 *       title: "",
 *     },
 *     audio: {
 *       duration: 320.388934,
 *       endOffset: 320.388934,
 *       name: "Aaj-Se-Teri-Lyrical-Padman-Aksha.mp3",
 *       startOffset: 0,
 *     },
 *     lines: sampleDraft.lines.map((line, index) => ({
 *       ...line,
 *       id: line.id ?? `line-${index + 1}`,
 *       start:
 *         typeof line.start === "number"
 *           ? line.start
 *           : Number((41.44 + index * 5.85).toFixed(2)),
 *       words: buildSampleWords(line),
 *     })),
 *   });
 * }
 * ============================================================================
 */

export default function Home() {
  return <EditorShell project={createDefaultProject()} />;
}
