import { NextResponse } from "next/server";
import { readCompanyLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

/** Company logo (public: shown on the sign-in page and as the browser icon). */
export async function GET() {
  const logo = await readCompanyLogo();
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      // An uploaded SVG is served as an image only — never as an active document.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
