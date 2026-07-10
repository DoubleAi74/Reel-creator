import "./globals.css";

export const metadata = {
  title: "YouTube MP3 Segment Prototype",
  description: "Prototype UI for selecting a YouTube segment and converting it to MP3.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
