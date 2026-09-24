import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FigBloom CRM",
  description:
    "FigBloom Digital Group CRM (FIG-439 -- leads, contacts, companies)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
