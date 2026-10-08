/**
 * Thin wrappers around lucide-react so call sites keep using the same
 * <IconX /> names (no props, inherits color via currentColor) regardless
 * of which icon set backs them. Sizes/stroke-width match the sidebar and
 * stat-chip CSS this project already has tuned.
 */
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  IdCard,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
  Users,
  type LucideProps,
} from "lucide-react";

const defaults: LucideProps = {
  size: 17,
  strokeWidth: 1.8,
};

export function IconDashboard(props: LucideProps) {
  return <LayoutDashboard {...defaults} {...props} />;
}

export function IconLeads(props: LucideProps) {
  return <Users {...defaults} {...props} />;
}

export function IconDeals(props: LucideProps) {
  return <Briefcase {...defaults} {...props} />;
}

export function IconTasks(props: LucideProps) {
  return <CheckSquare {...defaults} {...props} />;
}

export function IconReports(props: LucideProps) {
  return <BarChart3 {...defaults} {...props} />;
}

export function IconCompanies(props: LucideProps) {
  return <Building2 {...defaults} {...props} />;
}

export function IconContacts(props: LucideProps) {
  return <IdCard {...defaults} {...props} />;
}

export function IconSettings(props: LucideProps) {
  return <SlidersHorizontal {...defaults} {...props} />;
}

export function IconSearch(props: LucideProps) {
  return <Search {...defaults} {...props} />;
}

export function IconLogout(props: LucideProps) {
  return <LogOut {...defaults} size={15} {...props} />;
}

export function IconChevronsLeft(props: LucideProps) {
  return <ChevronLeft {...defaults} size={20} strokeWidth={2} {...props} />;
}

export function IconBell(props: LucideProps) {
  return <Bell {...defaults} {...props} />;
}

export function IconSun(props: LucideProps) {
  return <Sun {...defaults} {...props} />;
}

export function IconMoon(props: LucideProps) {
  return <Moon {...defaults} {...props} />;
}

export function IconChevronDown(props: LucideProps) {
  return <ChevronDown {...defaults} size={13} {...props} />;
}
