import "./globals.css";

export const metadata = {
  title: "Credit Dashboard Prototype",
  description: "Standalone credit dashboard prototype",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
