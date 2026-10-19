import { createFileRoute, Outlet } from '@tanstack/react-router';
import {
  Globe,
  LayoutDashboard,
  Library,
  Link2,
  ListChecks,
  PanelTopOpen,
  Search,
  Settings,
} from 'lucide-react';

import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { AppLayout } from '@/components/app-layout';
import type { NavItem } from '@/components/app-sidebar';
import { LocaleSelector } from '@/components/locale-selector';
import { ThemeToggle } from '@/components/theme-toggle';

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const navItems: NavItem[] = [
    {
      href: '/dashboard',
      label: m['dash.nav.dashboard'](),
      icon: LayoutDashboard,
    },
    {
      href: '/dashboard/backlinks',
      label: m['dash.nav.plaza'](),
      icon: Search,
    },
    {
      href: '/dashboard/my-backlinks',
      label: m['dash.nav.my_backlinks'](),
      icon: Library,
    },
    {
      href: '/dashboard/websites',
      label: m['dash.nav.websites'](),
      icon: Globe,
    },
    {
      href: '/dashboard/website-backlinks',
      label: m['dash.nav.tracking'](),
      icon: Link2,
    },
    {
      href: '/dashboard/quick-open',
      label: m['dash.nav.quick_open'](),
      icon: PanelTopOpen,
    },
    {
      href: '/dashboard/backlink-logs',
      label: m['dash.nav.logs'](),
      icon: ListChecks,
    },
    {
      href: '/dashboard/settings',
      label: m['dash.nav.settings'](),
      icon: Settings,
    },
  ];

  return (
    <AppLayout
      navItems={navItems}
      brand={envConfigs.app_name}
      logo={envConfigs.app_logo}
      brandHref="/dashboard"
      profileHref="/dashboard/settings"
      headerExtra={
        <>
          <LocaleSelector />
          <ThemeToggle />
        </>
      }
    >
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 pb-10 sm:px-6">
        <Outlet />
      </div>
    </AppLayout>
  );
}
