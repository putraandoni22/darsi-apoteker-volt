import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

function hasSessionCookie(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return typeof token === "string" && token.trim().length > 0;
}

export function middleware(request: NextRequest) {
  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signInUrl = new URL("/signin", request.url);
  const nextPath = `${pathname}${search}`;
  if (nextPath.length > 0 && nextPath !== "/") {
    signInUrl.searchParams.set("next", nextPath);
  }

  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/apoteker/:path*",
    "/pasien/:path*",
    "/dashboard/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/chat/:path*",
    "/assistant/:path*",
    "/api/admin/:path*",
    "/api/demo/:path*",
    "/api/chat/:path*",
  ],
};
