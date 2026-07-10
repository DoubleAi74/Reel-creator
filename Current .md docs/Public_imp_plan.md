-
-

Menue options panel

<!-- - Audio
  -- Current: Track upload, Get Lyrics
  -> Audio (combined) (Remove: Upload status, Section offsets, Track name, Duration )

- Lyrics
  -- Current: Edit text, timings, words

- Style
  -- Current: Text display, background -->

<!-- - Break down the API flow into optional parts

- Mp3 / YT->mp3
- Transcribe
- Translate + check
- Timings

YT to mp3 API

- youtube to mp3 api integration
- paste a link and go
- perhaps chose a segment of the video -->

- Add R2 to the credit dashboard part

- Integrate the YT part

- Integrate the Credit dashboard part

- Fix mobile browser view

- Fix colours

-
-
-
-

-
-
-
-
-
-
-

<!-- Backend

- basic mongo db database
- track the number of £ credits remaining
- sum up integration to add credits
- make £ go down with usage
- public password for the usage
- public dashboard for generations
- option to make your generations public or not

- Store MP3s in cloud flare R2 -->

Mobile browser view

- colapsible settings pannel (see design/future_mobile_app)
- Word board change:
  no scroll in mobile mode, go back to pannel cycle mode (buttons in the top right and left)
- words in the word board should be larger
- Audio scrub should be at the top (beneath a minimal header in mobile version)

Header in mobile browser

- preview / word board, dashboard, colapsable crdits view (request the passwoord button)

-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-
-

[DESCRIBE THE DESIRED CHANGE AND ITS PURPOSE.]

First, inspect the current codebase and relevant files so your understanding is up to date.

Then create:

- [PLAN_FILE], containing a detailed implementation plan for the proposed changes.
- [PROGRESS_FILE], containing a step-by-step implementation guide and progress tracker that a fresh agent can follow.

Save both documents in [TARGET_FOLDER].

Before creating them, ask all questions needed to clarify the intended outcome, scope, constraints, and implementation preferences. Do not begin implementation.

...

Good. Now write a paste-ready kickoff prompt for a fresh agent to implement the plan, including all necessary context, required reading, progress tracking, validation, and how to handle ambiguities or deviations.

---

-
-
-
-
-
-
-
-
-
-
-

Mobile browser scroll chanhes.

- Word board / preview should always be pinned beneath the audio scrub and should never scrol up begind it (perview/wordboard should get added to the pinned bloack at the top)

- full and peek toggle still decides how bit the preview/wordboard is (tall). And when this toggle is made, the settings pannel should get set to be vertically just beneath the wordboard/preview.

- Make the tab button area (audio, lyrics, style) narrower (shorter).
  ACTUALLY no, do this: In mobile browser view, remove the next lyric, last lyric and speed mode button. Move the play pause button down to be in line with the audio scrib to its left. Then, add the four tab buttons in the top right of the header.

OR just make that tab button area shorter.

- Make it so the menue area (When not in words mode) can be scrolled up to cover the word board/preview, then scrolled down, getting stuck just below the wordboard/preview where it started.

- Make the audio scrun a little shorter

- Make the preview/word board either or and make the button narrower.

- Go with the tab buttons on top:

Audio, Lyrics, Style, Words, toggle P/W, hamburger with links to dash and credits.

- drag scrolling anywhere on the screen will move up the menue panel and not slide the P/WB

-- When on the words tab, the height of the words display area should be fixed so that it all shows from the bottom up
