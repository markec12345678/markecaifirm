import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Markec AI Firm — Opportunity Monitor",
  description: "Lokalni AI lovec priložnosti za Bolha, Nepremičnine in druge slovenske portale.",
  keywords: ["AI", "monitor", "Bolha", "Nepremičnine", "Ollama", "priložnosti"],
  authors: [{ name: "Markec AI Firm" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sl" suppressHydrationWarning className="dark">
      <body
        className={`${geistMono.variable} antialiased bg-background text-foreground scanline-bg min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
