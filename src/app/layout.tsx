import type { Metadata, Viewport } from "next";
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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Markec AI",
  },
  openGraph: {
    title: "Markec AI Firm",
    description: "AI lovec priložnosti za slovenske portale",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sl" suppressHydrationWarning className="dark">
      <head>
        {/* Service worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('[SW] registered:', registration.scope);
                  }).catch(function(err) {
                    console.warn('[SW] registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body
        className={`${geistMono.variable} antialiased bg-background text-foreground scanline-bg min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
