import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
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
    <html lang="en" className={brandFont.variable}>
      <body>{children}</body>
    </html>
  );
}
