import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getAdminCredentials,
  getAdminSessionToken
} from "@/lib/admin-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  const credentials = getAdminCredentials();

  if (body.username !== credentials.username || body.password !== credentials.password) {
    return NextResponse.json({ message: "管理员账号或密码错误" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: getAdminSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: "/"
  });

  return response;
}
