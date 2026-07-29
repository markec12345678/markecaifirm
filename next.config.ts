import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // v6.92 FIX: `ignoreBuildErrors: true` odstranjen.
  // Prej so se TypeScript napake tiho ignorirale pri buildu — claim "0 TS errors" v README
  // je bil zavajajoč. Sedaj bo build fail-al, če so TS napake.
  // (types: { ignoreBuildErrors: false } je default, a eksplicitno dokumentiramo)
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
};

export default nextConfig;
