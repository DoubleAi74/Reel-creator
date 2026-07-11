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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
