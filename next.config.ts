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
  // Files file tracing cannot see: pdfkit (under @react-pdf) loads its built-in fonts by a computed path, and
  // Node 22+ resolves these packages' "module-sync" export (require.mjs), which the tracer does not copy.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pdfkit/js/standard-fonts/**",
      "./node_modules/generator-function/require.mjs",
      "./node_modules/async-function/require.mjs",
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
    // Shared hosting caps processes per account: build with a single worker or page generation fails with EAGAIN.
    cpus: 1,
    staticGenerationMaxConcurrency: 2,
    // Middleware buffers request bodies up to this size (default 10 MB). Employee documents may be 10 MB plus the
    // multipart envelope (POST /api/v1/employees/[id]/documents enforces the real limit).
    middlewareClientMaxBodySize: "11mb",
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
