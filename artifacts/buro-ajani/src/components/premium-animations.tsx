import { motion, AnimatePresence, type Variants } from "framer-motion";
import { type ReactNode, createContext, useContext } from "react";
import { triggerHaptic } from "@/hooks/use-device-environment";

const MotionContext = createContext({ reducedMotion: false });

export function MotionProvider({ children, reducedMotion = false }: { children: ReactNode; reducedMotion?: boolean }) {
  return <MotionContext.Provider value={{ reducedMotion }}>{children}</MotionContext.Provider>;
}

function useMotion() {
  return useContext(MotionContext);
}

function getDuration(base: number, reduced: boolean) {
  return reduced ? 0.01 : base;
}

export function PageTransition({ children, locationKey }: { children: ReactNode; locationKey: string }) {
  const { reducedMotion } = useMotion();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={locationKey}
        initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
        transition={{ duration: getDuration(0.25, reducedMotion), ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function FadeIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const { reducedMotion } = useMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: getDuration(0.4, reducedMotion), delay: reducedMotion ? 0 : delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SlideUp({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const { reducedMotion } = useMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: getDuration(0.4, reducedMotion), delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ScaleIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const { reducedMotion } = useMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: getDuration(0.35, reducedMotion), delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const staggerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const staggerChildVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

export function StaggerContainer({ children, className }: { children: ReactNode; className?: string }) {
  const { reducedMotion } = useMotion();
  if (reducedMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      variants={staggerVariants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const { reducedMotion } = useMotion();
  if (reducedMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={staggerChildVariants} className={className}>
      {children}
    </motion.div>
  );
}

export function PressableCard({
  children,
  className,
  onClick,
  haptic = true,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  haptic?: boolean;
}) {
  const { reducedMotion } = useMotion();
  return (
    <motion.div
      whileHover={reducedMotion ? {} : { y: -2, boxShadow: "0 8px 25px -5px rgba(0,0,0,0.1), 0 4px 10px -5px rgba(0,0,0,0.05)" }}
      whileTap={reducedMotion ? {} : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={className}
      onClick={() => {
        if (haptic) triggerHaptic("light");
        onClick?.();
      }}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      {children}
    </motion.div>
  );
}

export function HapticButton({
  children,
  onClick,
  className,
  hapticStyle = "light",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  hapticStyle?: "light" | "medium" | "heavy" | "success";
  disabled?: boolean;
}) {
  const { reducedMotion } = useMotion();
  return (
    <motion.button
      whileHover={reducedMotion ? {} : { scale: 1.02 }}
      whileTap={reducedMotion ? {} : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={className}
      disabled={disabled}
      onClick={() => {
        triggerHaptic(hapticStyle);
        onClick?.();
      }}
    >
      {children}
    </motion.button>
  );
}

export function CountUp({ value, duration = 1.2, className }: { value: number; duration?: number; className?: string }) {
  const { reducedMotion } = useMotion();
  return (
    <motion.span
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: getDuration(0.3, reducedMotion) }}
    >
      <motion.span
        key={value}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: getDuration(0.4, reducedMotion), ease: [0.22, 1, 0.36, 1] }}
      >
        {value.toLocaleString("fr-FR")}
      </motion.span>
    </motion.span>
  );
}

const pulseColors: Record<string, { ping: string; dot: string }> = {
  emerald: { ping: "bg-emerald-400", dot: "bg-emerald-500" },
  blue: { ping: "bg-blue-400", dot: "bg-blue-500" },
  amber: { ping: "bg-amber-400", dot: "bg-amber-500" },
  red: { ping: "bg-red-400", dot: "bg-red-500" },
  indigo: { ping: "bg-indigo-400", dot: "bg-indigo-500" },
  purple: { ping: "bg-purple-400", dot: "bg-purple-500" },
};

export function PulseIndicator({ color = "emerald", size = "sm" }: { color?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" };
  const c = pulseColors[color] || pulseColors.emerald;
  return (
    <span className="relative flex">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.ping} opacity-75`} />
      <span className={`relative inline-flex rounded-full ${sizes[size]} ${c.dot}`} />
    </span>
  );
}

export function FloatingElement({ children, className }: { children: ReactNode; className?: string }) {
  const { reducedMotion } = useMotion();
  if (reducedMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
