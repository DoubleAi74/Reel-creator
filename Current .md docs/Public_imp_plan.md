\_

DAY 1

-
-

Menue options panel

- Audio
  -- Current: Track upload, Get Lyrics
  -> Audio (combined) (Remove: Upload status, Section offsets, Track name, Duration)

- Lyrics
  -- Current: Edit text, timings, words

- Style
  -- Current: Text display, background

Break down the API flow into optional parts

- Mp3 / YT->mp3
- Transcribe
- Translate + check
- Timings

YT to mp3 API

- youtube to mp3 api integration
- paste a link and go
- perhaps chose a segment of the video

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

DAY2

-
-

Backend

- basic mongo db database
- track the number of £ credits remaining
- sum up integration to add credits
- make £ go down with usage
- public password for the usage
- public dashboard for generations
- option to make your generations public or not

- Store MP3s in cloud flare R2

Mobile browser view

- colapsible settings pannel (see design/future_mobile_app)
- Word board change:
  no scroll in mobile mode, go back to pannel cycle mode (buttons in the top right and left)
- words in the word board should be larger
- Audio scrub should be at the top (beneath a minimal header in mobile version)

Header in mobile browser

- preview / word board, dashboard, colapsable crdits view (request the passwoord button)

[DESCRIBE THE DESIRED CHANGE AND ITS PURPOSE.]

First, inspect the current codebase and relevant files so your understanding is up to date.

Then create:

- [PLAN_FILE], containing a detailed implementation plan for the proposed changes.
- [PROGRESS_FILE], containing a step-by-step implementation guide and progress tracker that a fresh agent can follow.

Save both documents in [TARGET_FOLDER].

Before creating them, ask all questions needed to clarify the intended outcome, scope, constraints, and implementation preferences. Do not begin implementation.

...

Good. Now write a paste-ready kickoff prompt for a fresh agent to implement the plan, including all necessary context, required reading, progress tracking, validation, and how to handle ambiguities or deviations.
