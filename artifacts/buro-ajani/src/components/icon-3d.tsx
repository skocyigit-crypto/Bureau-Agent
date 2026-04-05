import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Icon3DVariant = "blue" | "emerald" | "amber" | "purple" | "rose" | "indigo" | "cyan" | "orange" | "slate" | "navy" | "teal" | "red";
type Icon3DSize = "xs" | "sm" | "md" | "lg" | "xl";

const variantStyles: Record<Icon3DVariant, { bg: string; shadow: string; icon: string; ring: string }> = {
  blue: {
    bg: "bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(59,130,246,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-blue-300/30",
  },
  emerald: {
    bg: "bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-emerald-300/30",
  },
  amber: {
    bg: "bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(245,158,11,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-amber-300/30",
  },
  purple: {
    bg: "bg-gradient-to-br from-purple-400 via-purple-500 to-purple-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(147,51,234,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-purple-300/30",
  },
  rose: {
    bg: "bg-gradient-to-br from-rose-400 via-rose-500 to-rose-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(244,63,94,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-rose-300/30",
  },
  indigo: {
    bg: "bg-gradient-to-br from-indigo-400 via-indigo-500 to-indigo-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(99,102,241,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-indigo-300/30",
  },
  cyan: {
    bg: "bg-gradient-to-br from-cyan-400 via-cyan-500 to-cyan-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(6,182,212,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-cyan-300/30",
  },
  orange: {
    bg: "bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(249,115,22,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-orange-300/30",
  },
  slate: {
    bg: "bg-gradient-to-br from-slate-400 via-slate-500 to-slate-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(100,116,139,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-slate-300/30",
  },
  navy: {
    bg: "bg-gradient-to-br from-[#2a3f6a] via-[#1a2744] to-[#0f1a2e]",
    shadow: "shadow-[0_6px_20px_-4px_rgba(26,39,68,0.7),inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-2px_4px_rgba(0,0,0,0.25)]",
    icon: "text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-amber-400/20",
  },
  teal: {
    bg: "bg-gradient-to-br from-teal-400 via-teal-500 to-teal-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(20,184,166,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-teal-300/30",
  },
  red: {
    bg: "bg-gradient-to-br from-red-400 via-red-500 to-red-700",
    shadow: "shadow-[0_6px_20px_-4px_rgba(239,68,68,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_4px_rgba(0,0,0,0.15)]",
    icon: "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]",
    ring: "ring-red-300/30",
  },
};

const sizeStyles: Record<Icon3DSize, { container: string; icon: string }> = {
  xs: { container: "w-7 h-7 rounded-md", icon: "w-3.5 h-3.5" },
  sm: { container: "w-9 h-9 rounded-lg", icon: "w-4 h-4" },
  md: { container: "w-11 h-11 rounded-xl", icon: "w-5 h-5" },
  lg: { container: "w-14 h-14 rounded-xl", icon: "w-7 h-7" },
  xl: { container: "w-[4.5rem] h-[4.5rem] rounded-2xl", icon: "w-9 h-9" },
};

interface Icon3DProps {
  icon: LucideIcon;
  variant?: Icon3DVariant;
  size?: Icon3DSize;
  animate?: boolean;
  pulse?: boolean;
  className?: string;
}

export function Icon3D({ icon: Icon, variant = "blue", size = "md", animate = false, pulse = false, className }: Icon3DProps) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];

  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0",
        "transform-gpu",
        v.bg,
        v.shadow,
        s.container,
        "ring-1",
        v.ring,
        animate && "transition-all duration-300 hover:scale-110 hover:-translate-y-0.5 hover:shadow-xl",
        pulse && "animate-pulse",
        className
      )}
    >
      <Icon className={cn(s.icon, v.icon)} />
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/20 to-transparent pointer-events-none" style={{ height: '50%' }} />
    </div>
  );
}

export function Icon3DFlat({ icon: Icon, variant = "blue", size = "md", className }: Omit<Icon3DProps, "animate" | "pulse">) {
  const flatVariants: Record<Icon3DVariant, { bg: string; icon: string }> = {
    blue: { bg: "bg-blue-100 dark:bg-blue-900/30", icon: "text-blue-600 dark:text-blue-400" },
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/30", icon: "text-emerald-600 dark:text-emerald-400" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/30", icon: "text-amber-600 dark:text-amber-400" },
    purple: { bg: "bg-purple-100 dark:bg-purple-900/30", icon: "text-purple-600 dark:text-purple-400" },
    rose: { bg: "bg-rose-100 dark:bg-rose-900/30", icon: "text-rose-600 dark:text-rose-400" },
    indigo: { bg: "bg-indigo-100 dark:bg-indigo-900/30", icon: "text-indigo-600 dark:text-indigo-400" },
    cyan: { bg: "bg-cyan-100 dark:bg-cyan-900/30", icon: "text-cyan-600 dark:text-cyan-400" },
    orange: { bg: "bg-orange-100 dark:bg-orange-900/30", icon: "text-orange-600 dark:text-orange-400" },
    slate: { bg: "bg-slate-100 dark:bg-slate-900/30", icon: "text-slate-600 dark:text-slate-400" },
    navy: { bg: "bg-[#1a2744]/10 dark:bg-[#1a2744]/40", icon: "text-[#1a2744] dark:text-amber-400" },
    teal: { bg: "bg-teal-100 dark:bg-teal-900/30", icon: "text-teal-600 dark:text-teal-400" },
    red: { bg: "bg-red-100 dark:bg-red-900/30", icon: "text-red-600 dark:text-red-400" },
  };
  const fv = flatVariants[variant];
  const s = sizeStyles[size];

  return (
    <div className={cn("flex items-center justify-center shrink-0", fv.bg, s.container, className)}>
      <Icon className={cn(s.icon, fv.icon)} />
    </div>
  );
}

const pageIconMap: Record<string, { variant: Icon3DVariant }> = {
  "/": { variant: "navy" },
  "/appels": { variant: "blue" },
  "/contacts": { variant: "indigo" },
  "/taches": { variant: "emerald" },
  "/messages": { variant: "amber" },
  "/rapports": { variant: "rose" },
  "/logiciels": { variant: "purple" },
  "/analyse": { variant: "cyan" },
  "/utilisateurs": { variant: "teal" },
  "/stock": { variant: "orange" },
  "/pointage": { variant: "slate" },
  "/agents-ia": { variant: "purple" },
  "/parametres": { variant: "slate" },
};

export function SidebarIcon3D({ icon, href }: { icon: LucideIcon; href: string }) {
  const mapping = pageIconMap[href] || { variant: "blue" as Icon3DVariant };
  return <Icon3D icon={icon} variant={mapping.variant} size="xs" />;
}

export { type Icon3DVariant, type Icon3DSize };
