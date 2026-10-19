import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "exceljs", "@react-pdf/renderer"],
  // pdfkit (under @react-pdf) loads its built-in fonts by a computed path, which file tracing cannot see.
  outputFileTracingIncludes: { "/**": ["./node_modules/pdfkit/js/standard-fonts/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  webpack(config) {
    // The sync agent's database and logs live in agent/; changes there must not trigger dev recompiles.
    config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.git/**", "**/agent/**", "**/.playwright-mcp/**", "**/docker/backups/**"] };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
