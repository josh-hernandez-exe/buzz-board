import "@/styles/globals.css";

import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { TRPCReactProvider } from "@/trpc/react";
import { THEME_INIT_SCRIPT } from "@/utils/theme";

export const metadata: Metadata = {
  title: "Buzz Board",
  description: "Buzzer & Scoreboard System by Josh Hernandez",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

// Atkinson Hyperlegible is designed for readability, including low vision;
// Bricolage Grotesque gives headings and the board their game-show feel.
const body = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-body",
});
const heading = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-heading",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${heading.variable}`}
      // The theme script below sets the "dark" class before React loads.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
        {/* Its script only exists on Vercel; elsewhere it would 404. */}
        {process.env.VERCEL && <SpeedInsights />}
      </body>
    </html>
  );
}
