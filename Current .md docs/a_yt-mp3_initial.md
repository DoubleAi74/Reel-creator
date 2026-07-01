I want a simple html page which uses the api listed in (rapidapi-youtube-mp3-segment-integration-guide.md) to make a simple youtube to mp3 feature on a basic html page.

The page should have a button, a text input. Paste the youtube link into the text input, and when the button is pressed, it opens a pop up modal in the center of the screen with a view of the youtube video. From there, the user should be able to seamlessly select one segment of the video, with two sliding boundaries on a scrub component.

Then, clicking a button on the modal will confirm the segment choice and send the request to the youtube to mp3 api asking for that particular segment.

When the segment is downloaded an audio player should show up on the page below the button and the text input where the user can play the audio.
