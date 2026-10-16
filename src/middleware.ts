import { NextResponse, type NextRequest } from "next/server";

// Fast pre-check only: sends visitors without a session cookie to /login.
// The session itself is validated on the server for every page and action (src/server/auth/session.ts).

// /api/v1/agent authenticates each request with the agent's HMAC signature instead of a session cookie.
const PUBLIC_PATHS = ["/login", "/api/health", "/api/v1/agent"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.has("rfs_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
