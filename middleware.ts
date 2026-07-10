import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, getAdminSessionToken } from "@/lib/admin-auth";

function isPublicRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (/^\/matchdays\/[^/]+\/share$/.test(pathname)) return true;
  if (pathname.startsWith("/api/public/")) return true;
  if (pathname === "/api/admin/login") return true;
  if (request.method === "GET" && pathname === "/api/team-photos") return true;
  if (request.method === "GET" && pathname === "/api/uploads") return true;

  return false;
}

export function middleware(request: NextRequest) {
  if (isPublicRequest(request)) return NextResponse.next();

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token === getAdminSessionToken()) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "请先登录管理员" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("admin", "login_required");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/players/:path*",
    "/seasons/:path*",
    "/matchdays/:path*",
    "/team-photos/:path*",
    "/rankings/:path*",
    "/api/:path*"
  ]
};
