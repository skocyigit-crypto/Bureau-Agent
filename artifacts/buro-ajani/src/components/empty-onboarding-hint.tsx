import { motion } from "framer-motion";
import { Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";

type EmptyOnboardingHintProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tip?: string;
  testIdPrefix?: string;
};

export function EmptyOnboardingHint({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  tip,
  testIdPrefix = "empty-hint",
}: EmptyOnboardingHintProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center text-center px-6 py-12 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-gradient-to-b from-white/50 to-slate-50/50 dark:from-slate-900/30 dark:to-slate-800/30"
      data-testid={`${testIdPrefix}-container`}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-blue-500/10 dark:bg-blue-400/10 rounded-full blur-xl" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border border-blue-100 dark:border-blue-800/40 flex items-center justify-center">
          <Icon className="w-7 h-7 text-blue-600 dark:text-blue-400" />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
        {title}
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mb-5 leading-relaxed">
        {description}
      </p>

      {(actionLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
          {actionLabel && onAction && (
            <Button
              onClick={onAction}
              className="gap-1.5"
              data-testid={`${testIdPrefix}-action`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              variant="outline"
              onClick={onSecondary}
              data-testid={`${testIdPrefix}-secondary`}
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}

      {tip && (
        <p className="text-xs text-slate-500 dark:text-slate-500 max-w-sm leading-relaxed mt-2">
          💡 {tip}
        </p>
      )}
    </motion.div>
  );
}
