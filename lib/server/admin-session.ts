import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, getAdminSessionToken } from "@/lib/admin-auth";

export function hasAdminSession() {
  return cookies().get(ADMIN_SESSION_COOKIE)?.value === getAdminSessionToken();
}

export function adminRequiredResponse() {
  return NextResponse.json({ message: "请先登录管理员" }, { status: 401 });
}
