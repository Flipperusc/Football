import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DeepSeekError } from "@/lib/ai/deepseek-client";
import { PlayerIdentityConflictError } from "@/lib/server/player-identities";

function prismaMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    if (error.message.includes("Authentication failed")) {
      return "数据库认证失败：请检查 .env 里的 DATABASE_URL 用户名和密码。";
    }
    if (error.message.includes("Can't reach database server")) {
      return "无法连接数据库：请确认 PostgreSQL 已启动，且 DATABASE_URL 的地址和端口正确。";
    }
    return `数据库初始化失败：${error.message}`;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P1000") {
      return "数据库认证失败：请检查 .env 里的 DATABASE_URL 用户名和密码。";
    }
    if (error.code === "P1001") {
      return "无法连接数据库：请确认 PostgreSQL 已启动。";
    }
    if (error.code === "P1003") {
      return "数据库不存在：请先创建 DATABASE_URL 指向的数据库并执行迁移。";
    }
    if (error.code === "P2021") {
      return "数据库表不存在：请先执行 Prisma migration。";
    }
    return `数据库错误 ${error.code}：${error.message}`;
  }

  return null;
}

export function apiErrorResponse(error: unknown, fallback = "请求处理失败") {
  if (error instanceof DeepSeekError) {
    return NextResponse.json(
      {
        message: error.message,
        code: error.code
      },
      { status: error.status }
    );
  }

  if (error instanceof PlayerIdentityConflictError) {
    return NextResponse.json(
      {
        message: error.message,
        code: error.code,
        value: error.value
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        message: "提交数据格式不正确",
        issues: error.issues
      },
      { status: 400 }
    );
  }

  const databaseMessage = prismaMessage(error);
  if (databaseMessage) {
    return NextResponse.json({ message: databaseMessage }, { status: 503 });
  }

  return NextResponse.json(
    {
      message: error instanceof Error ? error.message : fallback
    },
    { status: 500 }
  );
}
