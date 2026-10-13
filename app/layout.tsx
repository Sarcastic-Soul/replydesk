import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { TopBar } from "@/components/top-bar";
import { Providers } from "@/components/providers";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-fraunces", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ReplyDesk", template: "%s · ReplyDesk" },
  description: "Short, warm replies to Google reviews, written in the shop owner's voice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <Providers>
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
