\_

DAY 1

-
-

Menue options panel

<!-- - Audio
  -- Current: Track upload, Get Lyrics
  -> Audio (combined) (Remove: Upload status, Section offsets, Track name, Duration)

- Lyrics
  -- Current: Edit text, timings, words

- Style
  -- Current: Text display, background -->

- Break down the API flow into optional parts

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

dashboard svg briefcase

<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" />
</svg>

money svg for money part

<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
</svg>
