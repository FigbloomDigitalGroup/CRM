import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { DevChips } from "./_dev/DevChips";
import "./globals.css";

const brandFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-brand",
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
    <html lang="en" className={brandFont.variable} suppressHydrationWarning>
      <body>
        {children}
        {/* Dev sign-in chips (F1.07): nothing in production, and not part of any frozen page. */}
        <DevChips />
      </body>
    </html>
  );
}
