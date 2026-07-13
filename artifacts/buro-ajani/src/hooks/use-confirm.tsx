import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Handler = (opts: ConfirmOptions) => Promise<boolean>;

let handler: Handler | null = null;

/**
 * Module-level confirm helper — call from anywhere without React hooks.
 * Falls back to native window.confirm if the provider hasn't mounted yet.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (handler) return handler(opts);
  return Promise.resolve(window.confirm(`${opts.title}${opts.description ? "\n\n" + opts.description : ""}`));
}

interface QueueEntry {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<QueueEntry | null>(null);
  const queueRef = useRef<QueueEntry[]>([]);
  const currentRef = useRef<QueueEntry | null>(null);

  const showNext = () => {
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  };

  useEffect(() => {
    handler = (opts) =>
      new Promise<boolean>((resolve) => {
        const entry: QueueEntry = { opts, resolve };
        if (currentRef.current) {
          queueRef.current.push(entry);
        } else {
          currentRef.current = entry;
          setCurrent(entry);
        }
      });
    return () => {
      handler = null;
    };
  }, []);

  const close = (result: boolean) => {
    const entry = currentRef.current;
    if (entry) entry.resolve(result);
    showNext();
  };

  return (
    <>
      {children}
      <AlertDialog open={!!current} onOpenChange={(o) => { if (!o) close(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{current?.opts.title}</AlertDialogTitle>
            {current?.opts.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {current.opts.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {current?.opts.cancelLabel ?? "Annuler"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={current?.opts.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {current?.opts.confirmLabel ?? "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
