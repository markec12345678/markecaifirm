import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Markec AI Firm — Opportunity Monitor",
    template: "%s | Markec AI Firm",
  },
  description: "Lokalni AI lovec priložnosti za Bolha, Nepremičnine, Vinted, Avtonet, mobile.de in druge slovenske ter evropske portale. 432 AI funkcij, 11 platform, local-first in zero-cloud.",
  keywords: [
    "AI", "monitor", "Bolha", "Nepremičnine", "Ollama", "priložnosti",
    "Vinted", "Avtonet", "mobile.de", "Kleinanzeigen", "Subito", "Willhaben",
    "reselling", "flipping", "AI trading", "opportunity monitor", "Slovenia",
    "bolha.com", "nepremicnine.net", "cross-border arbitraža",
  ],
  authors: [{ name: "Markec AI Firm", url: "https://github.com/markec12345678/markecaifirm" }],
  creator: "Markec AI Firm",
  publisher: "Markec AI Firm",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
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
    title: "Markec AI Firm — AI Opportunity Monitor",
    description: "Lokalni AI lovec priložnosti za Bolha, Nepremičnine, Vinted in 8 drugih platform. 432 AI funkcij, local-first, zero-cloud.",
    type: "website",
    locale: "sl_SI",
    siteName: "Markec AI Firm",
    images: [
      {
        url: "/icon-512.png",
        width: 512,
        height: 512,
        alt: "Markec AI Firm — AI Opportunity Monitor za slovenske oglase",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Markec AI Firm — AI Opportunity Monitor",
    description: "Lokalni AI lovec priložnosti za Bolha, Nepremičnine in 9 drugih platform.",
    images: ["/icon-512.png"],
  },
  alternates: {
    canonical: "/",
  },
  category: "technology",
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
    <html lang="sl" suppressHydrationWarning>
      <head>
        {/* Service worker registration — v8.95: samo v production (v dev mode povzroča ChunkLoadError zaradi stale chunk cache) */}
        {process.env.NODE_ENV === 'production' ? (
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
        ) : (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    regs.forEach(function(r) { r.unregister(); });
                    if (window.caches) {
                      caches.keys().then(function(names) { names.forEach(function(n) { caches.delete(n); }); });
                    }
                  });
                }
              `,
            }}
          />
        )}
        {/* v9.21: JSON-LD Structured Data za SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Markec AI Firm — Opportunity Monitor",
              "description": "Lokalni AI lovec priložnosti za Bolha, Nepremičnine, Vinted, Avtonet, mobile.de in druge slovenske ter evropske portale. 432 AI funkcij, 11 platform, local-first in zero-cloud.",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "inLanguage": "sl-SI",
              "author": {
                "@type": "Organization",
                "name": "Markec AI Firm",
                "url": "https://github.com/markec12345678/markecaifirm"
              },
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "EUR",
                "description": "Local-first, zero-cloud — brezplačna in odprtokodna"
              },
              "featureList": [
                "AI analiza oglasov (432 AI funkcij)",
                "Spremljanje 11 platform (Bolha, Nepremičnine, Vinted, Avtonet, mobile.de, Kleinanzeigen, Subito, Willhaben, Quoka, Salomon, Custom RSS)",
                "AI Deal Score 0-100",
                "Iskalnik z Buy Score + Compare + AI Advisor",
                "Auto-pilot z varnimi pravili",
                "Web Push obvestila",
                "Telegram bot integracija",
                "Cross-border arbitraža (DE→SI, IT→SI, AT→SI)",
                "Profit tracking + ROI analitika",
                "Brain intelligence (7 domen)"
              ],
              "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "5",
                "ratingCount": "1",
                "bestRating": "5",
                "worstRating": "1"
              }
            })
          }}
        />
      </head>
      <body
        className={`${geistMono.variable} antialiased bg-background text-foreground scanline-bg min-h-screen`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
