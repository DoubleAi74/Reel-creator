import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/700.css";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/500.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "./app_colours.css";
import "./globals.css";

const criticalShellCss = `
:root {
  color-scheme: light;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: #f0f0ea;
  color: #343332;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  min-height: 100vh;
}

body:not(.app-css-ready) {
  overflow: hidden;
}

body:not(.app-css-ready) .app-frame {
  visibility: hidden;
}

body:not(.app-css-ready)::before,
body:not(.app-css-ready)::after {
  position: fixed;
  left: 50%;
  z-index: 2147483647;
  transform: translateX(-50%);
  text-align: center;
}

body:not(.app-css-ready)::before {
  content: "Cross Lang";
  top: 42%;
  color: #343332;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

body:not(.app-css-ready)::after {
  content: "Loading editor...";
  top: calc(42% + 38px);
  color: #747372;
  font-size: 14px;
  font-weight: 500;
}

body.app-css-timeout:not(.app-css-ready)::after {
  content: "Still loading styles. Refresh if this stays here.";
  width: min(82vw, 340px);
  line-height: 1.45;
}

input[type="file"][hidden],
input[type="file"].hidden {
  display: none !important;
}

body:not(.app-css-ready) button,
body:not(.app-css-ready) input,
body:not(.app-css-ready) select,
body:not(.app-css-ready) textarea {
  font: inherit;
}

body:not(.app-css-ready) img,
body:not(.app-css-ready) svg {
  max-width: 100%;
  height: auto;
}

body:not(.app-css-ready) svg:not([width]) {
  width: 24px;
  height: 24px;
}
`;

const cssReadyScript = `
(function () {
  var attempts = 0;
  var maxAttempts = 600;

  function hasAppCss() {
    var value = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--app-css-ready")
      .trim();
    return value === "1";
  }

  function markReady() {
    if (!document.body) {
      return;
    }
    document.body.classList.add("app-css-ready");
    document.body.classList.remove("app-css-timeout");
  }

  function check() {
    if (hasAppCss()) {
      markReady();
      return;
    }

    attempts += 1;
    if (attempts === 120 && document.body) {
      document.body.classList.add("app-css-timeout");
    }

    if (attempts < maxAttempts) {
      window.setTimeout(check, 50);
    }
  }

  function start() {
    window.requestAnimationFrame(check);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
`;

export const metadata = {
  title: "Cross Lang",
  description: "Language is connection, connection is life.",
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Immersive Translate)
    // stamp attributes such as data-immersive-translate-page-theme onto <html>
    // before React hydrates; without this they trip a hydration mismatch error.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <style
          id="critical-shell-css"
          dangerouslySetInnerHTML={{ __html: criticalShellCss }}
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <script
          id="css-ready-guard"
          dangerouslySetInnerHTML={{ __html: cssReadyScript }}
        />
        {children}
      </body>
    </html>
  );
}
