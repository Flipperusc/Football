import "antd/dist/reset.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "灵眸GPU",
  description: "灵眸GPU 球队赛季数据中心"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
