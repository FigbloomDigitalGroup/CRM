import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import localFont from "next/font/local";
import { DevChips } from "./_dev/DevChips";
import "./globals.css";

const brandFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

// The logo's own typeface, the same one Figbloom HR uses: semibold "Figbloom" and a light product name. Outfit's Latin variable font (weights 100 to 900)
// is served from this repository, so building the image never depends on reaching Google Fonts (the Docker build failed on that).
const logoFont = localFont({
  src: "./fonts/outfit-latin.woff2",
  weight: "100 900",
  variable: "--font-logo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CRM | Figbloom",
  description: "FigBloom Digital Group's internal CRM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${brandFont.variable} ${logoFont.variable}`} suppressHydrationWarning>
      <body>
        {children}
        {/* Dev sign-in chips (F1.07): nothing in production, and not part of any frozen page. */}
        <DevChips />
      </body>
    </html>
  );
}
