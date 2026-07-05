"use client";

import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#0f766e",
          borderRadius: 8,
          fontFamily: 'Arial, "Microsoft YaHei", sans-serif'
        },
        components: {
          Card: { borderRadiusLG: 8 },
          Button: { borderRadius: 8 },
          Table: { headerBg: "#f1f5f9" }
        }
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
