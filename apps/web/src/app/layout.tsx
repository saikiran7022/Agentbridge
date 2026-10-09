import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Liaison Hub",
  description: "Your team's agents talk to each other so people don't have to chase answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
