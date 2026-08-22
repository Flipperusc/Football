import "antd/dist/reset.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://football.flipperusc.work"),
  applicationName: "灵眸GPU 球队数据中心",
  title: {
    default: "灵眸GPU｜球队数据中心",
    template: "%s｜灵眸GPU"
  },
  description: "查看灵眸GPU足球队赛季积分、进球、助攻、出勤、球员阵容与赛后战报。",
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "灵眸GPU 球队数据中心",
    title: "灵眸GPU｜球队数据中心",
    description: "记录每一次上场，查看球队赛季榜单、球员表现与赛后战报。",
    images: [{ url: "/og-card.svg", width: 1200, height: 630, alt: "灵眸GPU 足球队数据中心" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "灵眸GPU｜球队数据中心",
    description: "记录每一次上场，查看球队赛季榜单、球员表现与赛后战报。",
    images: ["/og-card.svg"]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <AppShell aiConfigured={Boolean(process.env.DEEPSEEK_API_KEY?.trim())}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
