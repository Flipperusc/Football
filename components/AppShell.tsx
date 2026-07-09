"use client";

import {
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  ClipboardPlus,
  Home,
  Images,
  Trophy,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Layout, Menu } from "antd";

const { Sider, Content } = Layout;

const items = [
  { key: "/admin", icon: <Home size={18} />, label: <Link href="/admin">控制台</Link> },
  { key: "/players", icon: <Users size={18} />, label: <Link href="/players">球员</Link> },
  { key: "/seasons", icon: <CalendarRange size={18} />, label: <Link href="/seasons">赛季</Link> },
  {
    key: "/matchdays/internal",
    icon: <ClipboardPlus size={18} />,
    label: <Link href="/matchdays/internal">队内赛录入</Link>
  },
  {
    key: "/matchdays/external",
    icon: <ClipboardCheck size={18} />,
    label: <Link href="/matchdays/external">队外赛录入</Link>
  },
  { key: "/team-photos", icon: <Images size={18} />, label: <Link href="/team-photos">球队风采</Link> },
  { key: "/rankings", icon: <Trophy size={18} />, label: <Link href="/rankings">榜单</Link> }
];

function selectedKey(pathname: string) {
  if (pathname.startsWith("/admin")) return "/admin";
  if (pathname.startsWith("/players")) return "/players";
  if (pathname.startsWith("/seasons")) return "/seasons";
  if (pathname.startsWith("/matchdays/internal")) return "/matchdays/internal";
  if (pathname.startsWith("/matchdays/external")) return "/matchdays/external";
  if (pathname.startsWith("/team-photos")) return "/team-photos";
  if (pathname.startsWith("/rankings")) return "/rankings";
  return "/admin";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/") {
    return <>{children}</>;
  }

  return (
    <Layout className="app-layout">
      <Sider width={232} theme="light" breakpoint="lg" collapsedWidth={0} className="app-sidebar">
        <div className="app-logo">
          <BarChart3 size={18} />
          <span style={{ marginLeft: 8 }}>Football Stats</span>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey(pathname)]} items={items} />
      </Sider>
      <Content className="app-content">
        <div className="app-top-actions">
          <Link href="/">
            <Button icon={<Home size={16} />}>返回前台</Button>
          </Link>
        </div>
        {children}
      </Content>
    </Layout>
  );
}
