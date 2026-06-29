# Follow Audio Integration

Status: agreed feature specification. Implementation not started in this document.

Last updated: 2026-06-26 (resolver authority revised — see §6)

## 1. Goal

Add a real function behind the Word Board `F` button: **Follow Audio mode**.

When enabled, the Word Board follows the current audio playhead. It highlights the active lyric line, highlights the word or words currently being sung, and marks already-heard words with a subtle passed state. The feature is for the Word Board only. It must not change the video preview captions or exported video yet.

The target feel is calm, readable, and professional. The highlights should be informative without making the board visually noisy.

## 2. Non-goals

- Do not add timed word highlighting to the phone/video preview in this phase.
- Do not change Remotion export behavior.
- Do not make the bottom word translation panel automatically follow audio. It remains controlled by manual word selection.
- Do not couple the Word Board `F` button to the Timing tab's existing auto-follow pill.
- Do not persist the `F` state in project JSON. It resets each session.

## 3. Current Code Context

The implementation agent should read these files first:

- `components/word-board/word-board.js`
  - Renders `WordBoard`, `BoardControls`, `LineRow`, `WordTile`, and `SelectionPanel`.
  - The `F` button currently exists as a placeholder with no behavior.
  - Manual word selection is intentionally independent and can be `null`.
- `components/word-board/use-word-board.js`
  - Owns board layout, tile scale, roman toggle, line wrapping, and scroll preservation.
  - It currently contains older line-only auto-follow logic using `activeSourceLineId`, `autoFollow`, and `isPlaying`.
  - That old behavior must not keep scrolling/highlighting when the new `F` mode is off.
- `components/word-board/word-board.css`
  - Owns all tile, line, selection panel, and control styling.
  - Add follow styles here; keep them scoped under `.version-sketch`.
- `lib/word-board.js`
  - Prepares board display lines and words.
  - Currently `prepareBoardLines()` does not preserve word timing metadata. Follow Audio needs that metadata carried into display words.
- `components/editor-shell.js`
  - Owns `currentAudioTime`, `isTransportPlaying`, `projectState.lines`, and the two `<WordBoard>` mount sites.
  - `currentAudioTime` is the existing single source of truth for playhead time and is updated by `WaveformTimeline`.
- `components/editor-state.js`
  - Has `playback.currentTime`, but `editor-shell.js` deliberately avoids publishing current time each tick. Prefer passing `currentAudioTime` directly into `<WordBoard>` for this first implementation.
- `lib/timing.js`
  - Existing `findActiveLine()` is line-start/lead-in based for caption timing. Do not reuse it directly for Follow Audio word highlighting, because this feature needs word-level current/passed states and different gap rules.
- `lib/validate.js`, `lib/project.js`, `lib/word-meanings.js`
  - Confirm the merged word schema: `{ text, start, end, gloss, roman }`.

## 4. Verified Data Shape

The stored project model uses seconds as floating point numbers.

Line shape:

```js
{
  id: string,
  original: string,
  translation: string,
  romanization: string,
  start: number | null,
  end: number | null, // present in runtime lines, not currently exported
  words: Word[]
}
```

Word shape:

```js
{
  text: string,
  start: number | null,
  end: number | null,
  gloss: string | null,
  roman: string | null
}
```

Raw transcript word files in `samples/*.words.json` use:

```js
{ word: string, start: number, end: number }
```

After the lyric timing/meaning merge, the board should consume `line.words[]` with `text`, `start`, `end`, `gloss`, and `roman`.

There is no stored `duration` field on project words. Duration is `end - start`.

## 5. User-Confirmed Behavior

### F Button

- `F` toggles Follow Audio mode for the Word Board.
- Default state is off.
- The state is local/session-only. It is not saved into project JSON.
- Switching songs/loading a new project should reset it off.
- `F` should be disabled when the board does not have usable follow-audio data.
- Usable follow-audio data means at least one lyric line has a finite `line.start` and at least one board word has finite `start` and `end` timings. Line starts alone are not enough for this feature, because the feature is specifically word-following.
- Disabled state:
  - greyed out
  - not clickable
  - tooltip/title such as `Follow audio unavailable until word timings exist`
- Enabled/pressed state should visually match the `Rm` toggle: dark pressed style when on.

### Time Source

- Use the existing single source of truth: `currentAudioTime` in `components/editor-shell.js`.
- Follow highlighting must update when audio plays.
- Follow highlighting must also update when audio is paused and the user scrubs the playhead.
- The board should reflect the current playhead position whenever `currentAudioTime` changes. Do not require `isTransportPlaying`.

### Auto-scroll

- When `F` is on, the board should scroll the active line into view.
- The active line should be centered.
- When `F` is off, the board must not auto-scroll because of audio playback.
- When the user manually scrolls away from the current word/line while `F` is on:
  - audio line/word highlights continue updating
  - auto-scrolling pauses
  - a small `re-follow` button appears in the top-right corner of the stage/board area
- Clicking `re-follow`:
  - hides the button
  - resumes auto-scrolling
  - immediately centers the current active line if one exists
- If `F` is turned off, hide `re-follow` and clear the paused-follow state.

### Selection Panel And Manual Selection

- The bottom selection/translation box remains controlled by manual word selection only.
- Follow Audio must not select words.
- Follow Audio must not overwrite the selected word.
- If the user clicks a word while `F` is on, that manual selection stays independent.
- Selected tile styling overrides follow-audio tile styling.

## 6. Active Line Rules

Follow Audio needs a resolver separate from the current caption-oriented `findActiveLine()`.

> **Revision 2026-06-26 — word timing is the authority.** The original design (below,
> rules 1–5 as first written) made `line.start` the authority and clipped any word
> whose timing fell outside the `[line.start, nextLine.start)` window. In practice
> auto-timed `line.start` values are unreliable: they are compressed and routinely
> land *before*, and far closer together than, the words actually sung. Real songs
> regularly sing a line's words at or after the *next* line's nominal `line.start`,
> so the clip silently dropped good, correctly-timed words — they never became
> `current` and never became `passed`, leaving stray un-shaded tiles (and, when a
> whole line's words fell past the next line's start, an entire un-followed line).
> The video preview was unaffected because it does not clip words this way.
>
> The resolver now treats **word timing as authoritative** and `line.start` as a
> hint, per these rules:

1. Every timed word stays attached to its **structural** line. Never drop a word because its timing falls outside a line-start window.
2. Each line's active window is derived from its **own words**: `effStart = min(word.start)`, `effEnd = max(word.end)`. A line with no timed words falls back to `line.start` / `line.end`.
3. Order lines by `effStart` (where they are actually sung), not by `line.start`, so a line whose `line.start` hint is out of order still slots in correctly.
4. The active line is the latest (in sung order) whose window contains the playhead. `line.start` is used only to pull a line's highlight a little earlier (anticipation), clamped so it can never reach back across the previous line's sung words — **but a line's window must never open later than its own first sung word (`effStart`).** (Added 2026-06-27.) Auto-timed lines frequently overlap (a line's last word ends after the next line's first word begins). Without the `effStart` cap, the anti-overlap clamp held the next line's window shut until the previous line's last word ended, so a whole line stayed dark — highlighting only after the playhead had already moved through it. Capping at `effStart` guarantees a line lights up exactly when its words are sung.
5. Within the active line, word timing determines current/passed/future words (see §7).

Line background highlight:

- Highlight the active lyric line across the full horizontal line area, between the page rule above and the page rule below.
- If the lyric line wraps into two visual rows, one line highlight should span the whole wrapped line area.
- It should not be a pill just behind the visible word row; it should read as the whole ruled lyric line being active.
- If the current time is inside the active line but before the first timed word, show the line highlight with no current word.
- If there is a silent gap between lines:
  - keep the previous line highlighted for 100ms after its last timed word ends
  - highlight the next line 100ms before its first word starts or before its `line.start`, whichever is the practical active-line boundary
  - outside those 100ms grace windows, no line should be highlighted during the silence
- If there is no meaningful silent gap, transition normally to the next active line.

This reconciles two desired behaviors:

- The main sung span is first timed word to last timed word.
- The line may still highlight just before the first word or just after the last word for readability and anticipation.

## 7. Word State Rules

Each visible word can be in one of these audio states:

- `future`: unchanged normal tile
- `passed`: already heard
- `current`: currently being sung
- `untimed`: unchanged normal tile

Priority:

1. selected tile
2. hover/focus tile state
3. current audio word
4. passed audio word
5. normal/future tile

Current word:

- A word is current when `word.start <= currentTime <= word.end` **and the word is reachable** (see below).
- A word is **reachable** only if no earlier word, in reading order, is still in the future (`start > currentTime`). Words are sung left to right, so you cannot be currently singing a word while an earlier word has not begun. (Added 2026-06-27.)
  - This makes the resolver robust to out-of-order / stale-duplicate timing. Real example: a line ends with a duplicate "के" whose `start`/`end` were copied from an earlier "के". Without the reachability rule, both "के" tiles light as current simultaneously (they share timing), and in the gap right after, the stale duplicate drags the passed region forward — flashing every word up to it as passed and then un-shading them. The reachability rule rejects the unreachable duplicate, so only the real word is current and the passed region is never dragged past it.
  - Untimed words never block reachability (they make no claim about playback position).
- If two or more **reachable** words overlap, highlight all of them as current.
- If there is a gap between a word ending and the next word starting:
  - if the gap is less than or equal to 1000ms, keep the previous word current until the next word starts
  - if the gap is greater than 1000ms, show no current word during the gap
- At the instant the next word starts, the next word becomes current. The previous word becomes passed unless it genuinely overlaps.

Passed words (ordinal rule, revised 2026-06-26):

- Passed is resolved **ordinally** over **every** display word (timed or not), by reading position — not by each word's own end time. Two rules:
  1. Every word **strictly before the current word** (in reading order) shades passed.
  2. **No word at or after the current word ever shades.** (Revised 2026-06-27.)
- Rule 1 means a word that was skipped, that has odd/out-of-order timing, **or that has no timing at all** (e.g. a trailing untimed "गई", or an untimed word sandwiched between sung words) still shades passed once the playhead has moved past it. There are never stray un-shaded tiles stranded behind the playhead.
- Rule 2 matters because a word's stored timing can be out of order — e.g. a duplicate word copied to the end of a line carrying an early `start`. Without this rule that stray word would drag the passed region past the word actually being sung, wrongly shading the tiles between. The current word's reading position, not raw timing, bounds the passed region.
- When there is no current word (gap / before first / after last), the passed region extends to the furthest timed word that has actually started; trailing untimed words with nothing sung after them stay normal.
- All words before the current playhead show as passed, across all previous lines, not only the active line.
- After the final lyric, all words up to the last sung word show as passed.
- Before the first lyric, all words are normal.
- Current words do not also appear as passed.
- A **trailing** untimed word with nothing sung after it stays normal (it is not behind the frontier). Untimed words only shade once a later word has actually been reached. (Revised 2026-06-27: untimed words behind the frontier now shade passed; the earlier "untimed words always remain normal" rule was dropped because real auto-timed lines routinely contain untimed words that would otherwise read as stray cream tiles.)

Future words:

- Words ahead of the current playhead remain in the normal tile state.

Roman text:

- Roman text under tiles should not receive a separate color state.
- It should remain readable against current/passed tile backgrounds.

## 8. Visual Design

The desired appearance is subtle, polished, and easy to read.

Suggested initial CSS variables, to be tuned visually:

```css
.version-sketch {
  --follow-line-bg: rgba(255, 252, 242, 0.58);
  --follow-current-bg: #dcecff;
  --follow-passed-bg: #cfe1f2;
  --follow-tile-text: #27313f;
}
```

Guidance:

- Active line background: a slightly lighter version of the existing stage background.
- Current word tile: light blue, roughly similar lightness to the normal cream tile.
- Passed word tile: similar blue but slightly darker than current.
- Future word tile: unchanged.
- Text must stay dark and highly readable.
- Avoid bright saturated blue.
- Keep transitions short, around 90-150ms.
- Do not animate layout, only color/visual state.
- The selected dark tile style remains unchanged and overrides audio states.
- The line highlight should sit behind tiles and tile shadows.

Potential class names:

```txt
.line-row.is-follow-line
.word-button.is-follow-current
.word-button.is-follow-passed
.stage.is-follow-paused
.refollow-button
```

## 9. Proposed Architecture

### 9.1 Preserve Timing In Board Display Data

Update `prepareBoardLines()` in `lib/word-board.js` so display lines and words preserve timing metadata:

- line:
  - `sourceId`
  - `start`
  - `end`
- word:
  - `sourceLineId`
  - `sourceWordIndex`
  - `sourceWordKey`, for example `${line.id ?? lineIndex}:${wordIndex}`
  - `start`
  - `end`

Do not rely on word text for follow-state identity. Repeated lyrics and repeated words are common. Use line id plus word index where possible.

The scroll display line ids can remain `scroll-${lineIndex}`. Follow state can still use source ids/keys to survive display-id changes.

### 9.2 Add A Pure Follow Resolver

Add a pure helper module, suggested name:

```txt
lib/word-board-follow.js
```

Suggested exports:

```js
export const FOLLOW_LINE_GRACE_SECONDS = 0.1;
export const FOLLOW_WORD_GAP_HOLD_SECONDS = 1;

export function hasFollowAudioTiming(lines) {}

export function resolveFollowAudioState(lines, currentTime, options = {}) {}
```

Suggested return shape:

```js
{
  available: boolean,
  activeSourceLineId: string | null,
  activeDisplayLineId: string | null,
  currentWordKeys: string[],
  passedWordKeys: string[],
}
```

The helper should be DOM-free and unit-tested. It can accept prepared board lines so it can return display ids directly, or it can accept project lines and return source ids/keys. Choose the shape that keeps React code simplest, but keep the timing rules in this pure helper.

### 9.3 WordBoard Props

Update `<WordBoard>` to receive current time:

```jsx
<WordBoard
  lines={projectState.lines}
  selectedWordId={editor.state.selection.selectedWord?.id ?? null}
  onSelectWord={(word) => editor.actions.setSelectedWord(word)}
  currentTime={currentAudioTime}
  followAudioResetKey={...}
/>
```

The implementation should remove or stop using the old board auto-follow props:

- `activeSourceLineId`
- `autoFollow`
- `isPlaying`

Those old props currently make the board follow playback without the `F` button, which conflicts with the new requirement.

The Timing tab's `autoFollowEnabled` state should remain separate and continue to affect only Timing tab scrolling.

### 9.4 Follow State Location

Keep `followAudioEnabled` local to the Word Board/hook. This matches:

- default off
- reset each session
- not persisted
- not part of project JSON

Recommended hook ownership:

- `useWordBoard()` owns `followAudioEnabled`, `followScrollPaused`, and `re-follow` behavior.
- `WordBoard` renders the returned states and event handlers.

Alternative acceptable ownership:

- `WordBoard` owns `followAudioEnabled` and passes it into `useWordBoard()`.

Either is fine if the final API is simple and the state stays local.

### 9.5 Reset Behavior

Reset `followAudioEnabled` to false when a new project/song is loaded.

Suggested implementation:

- Add a `followAudioResetKey` prop.
- In `editor-shell.js`, derive it from project/audio identity or increment a local revision when importing/loading/replacing project audio.
- In `useWordBoard()` or `WordBoard`, effect on `followAudioResetKey`:
  - set `followAudioEnabled(false)`
  - set `followScrollPaused(false)`

Do not reset `F` merely because line timings are edited. Requirement: timing edits should be reflected live while follow mode is active.

### 9.6 Auto-scroll And Manual Scroll

Use the existing `stageRef`.

When:

- `followAudioEnabled`
- not `followScrollPaused`
- there is an active display line
- current time/active line changes

then center the active row:

```js
row.scrollIntoView({ behavior: "smooth", block: "center" });
```

Use a programmatic-scroll guard so the scroll event from `scrollIntoView()` is not treated as manual scrolling.

Manual scroll detection:

- listen via the existing stage `onScroll`
- if follow is enabled and the scroll was not programmatic, check whether the active row is still acceptably centered/visible
- if the user has moved away from the active line, set `followScrollPaused(true)`

Recommended tolerance:

- active row center differs from stage viewport center by more than about 25-30% of the stage height, or the active row is no longer visible

When paused:

- keep computing active/passed/current states from `currentTime`
- do not auto-scroll
- show `re-follow`

### 9.7 Rendering Follow Classes

`WordTile` should receive an audio state, for example:

```js
audioState: "current" | "passed" | null
```

Then add classes:

```js
word-button is-follow-current
word-button is-follow-passed
```

`LineRow` should receive whether it is the active follow line:

```js
line-row is-follow-line
```

Do not use the existing selected/hover line classes for audio. Keep separate class names so visual priority is explicit and easy to tune.

## 10. Edge Cases

- No word timings: `F` disabled.
- Line timings but no word timings: `F` disabled.
- Some words untimed: untimed words remain normal.
- Current time before first lyric: no active line, no current/passed words.
- Current time after final lyric: all timed words passed.
- Overlapping word timings: all overlapping words current.
- Long gap between words over 1000ms: no current word during the gap.
- Short gap between words up to 1000ms: previous word remains current until next starts.
- Gap between lines: no active line except 100ms grace after previous line and 100ms anticipation before next line.
- Word sung at/after the next line's nominal `line.start` (compressed line timing): the word is still followed via its own timing; it is not dropped (revised 2026-06-26).
- Whole line whose words are all sung past the next line's `line.start`: the line is still derived from its words, highlights, and shades passed (revised 2026-06-26).
- A line whose word span is fully contained inside a neighbouring line's span (severely overlapping bad data): its words still shade passed via the ordinal rule, but it may not win the line-background highlight. Acceptable residual edge.
- Tile size changes during playback: follow state continues uninterrupted.
- Roman mode changes during playback: follow state continues uninterrupted.
- Narrow screen: same behavior and same visual state rules.

## 11. Performance

Use the existing `currentAudioTime` updates. Do not introduce a polling interval.

Recommended approach:

- Compute follow state in `useMemo()` from:
  - prepared board lines
  - `currentTime`
  - `followAudioEnabled`
- Keep resolver work linear in number of words.
- This board has a modest number of lines/words, so a per-time-update scan is acceptable.
- If later profiling shows jank, optimize by precomputing a flattened timing timeline and binary searching by current time.

Do not publish `currentAudioTime` into the shared editor reducer on every tick unless there is a clear reason. Passing it directly to `<WordBoard>` is simpler and avoids extra global reducer churn.

## 12. Accessibility

- `F` button:
  - `aria-label="Toggle follow audio"`
  - `aria-pressed={followAudioEnabled}`
  - `disabled={!canFollowAudio}`
  - useful `title` for disabled and enabled/off/on states
- `re-follow` button:
  - real `<button>`
  - label text: `re-follow`
  - `aria-label="Re-follow current audio line"`
- Do not use color alone for selected state; selected state already has strong dark tile styling.
- Follow colors should meet readable contrast for tile text.

## 13. Testing Requirements

### Unit Tests

Add unit tests for the pure follow resolver:

- disabled/unavailable with no timed words
- before first lyric: no active line, no passed words
- active line before first word: line active, no current word
- current word inside word range
- passed words across previous lines
- after final lyric: all timed words passed
- overlapping words: both current
- short inter-word gap <= 1000ms: previous word remains current
- long inter-word gap > 1000ms: no current word during gap
- line gap grace: previous line +100ms, next line -100ms, silence otherwise
- word sung at/after the next line's nominal start is still followed and shaded (revised 2026-06-26)
- whole line whose words are all sung past the next line's start is still followed (revised 2026-06-26)
- ordinal passed: a tile behind the furthest-progressed tile shades passed even with out-of-order timing (revised 2026-06-26)
- untimed display words remain normal
- `prepareBoardLines()` preserves `start`/`end` metadata

### Browser / Playwright Verification

Use Playwright for visual and interaction checks:

- Desktop width around the current reference screenshot.
- Intermediate width around 1000-1100px.
- Narrow/mobile width.

Smoke checks:

- With no word timings, `F` is disabled and tooltip/title explains why.
- With timed words, `F` is enabled.
- Turning `F` on sets pressed visual state.
- Scrubbing/setting current time changes active line/current word without playback.
- Active line centers after turning `F` on.
- Manual scroll away shows `re-follow`.
- Highlights continue changing while follow scrolling is paused.
- Clicking `re-follow` centers the current line and hides the button.
- Manual word selection remains independent and selected style overrides follow style.
- Roman mode on: roman text remains readable over current/passed tiles.

Final checks:

```bash
npm run lint
npm test
npm run build
```

## 14. Future Note

The same timing resolver may later be useful for timed caption highlighting in the video preview, but that is explicitly out of scope for this implementation. Keep the resolver pure and general enough that it can be reused later without tying it to DOM or Word Board CSS.
