import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Liaison Hub",
  description: "Your team's agents talk to each other so people don't have to chase answers.",
};

// Runs before first paint so there is no flash of the wrong theme. Falls back to the OS setting.
const themeScript = `try{var t=localStorage.getItem("hub-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
