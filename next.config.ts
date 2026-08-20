import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // v8.93: hide the X-Powered-By: Next.js response header (minor info leak).
  poweredByHeader: false,

  // v7.24: ignoreBuildErrors: false — sedaj ko smo popravili vseh 48 TS napak (0 remaining)
  // je to varno. Build bo fail-al, če kdorkoli vnese novo TS napako.
  // Prej (v6.92-v7.21) je bil true, ker so bile pre-existing napake (playwright, TS18048).
  // PR #31 (v7.22) je popravil vse napake → sedaj lahko false.
  typescript: {
    ignoreBuildErrors: false,
  },

  // v6.92 FIX: `reactStrictMode: false` odstranjen (default je true).
  // Prej je bil izklopljen, kar je pomenilo, da se niso odkrili subtle re-render bug-i
  // v development-u. StrictMode je zdaj vklopljen — odkriva:
  // - nepure effects (ki bi težko tečli v prod)
  // - duplicate state updates
  // - missing dependency arrays v useEffect
  reactStrictMode: true,

  // v8.93: standard production security headers. These are non-breaking
  // hardening headers (no CSP, which could break inline styles/scripts).
  // SAMEORIGIN allows the app to frame itself if needed while blocking
  // cross-origin clickjacking.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
