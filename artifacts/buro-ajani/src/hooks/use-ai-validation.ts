import { useState, useCallback, useRef } from "react";
import { useRequestAiValidation } from "@workspace/api-client-react";

interface ValidationResult {
  isValid: boolean;
  errors: { champ: string; message: string }[];
  warnings: { champ: string; message: string }[];
  suggestions: { champ: string; suggestion: string }[];
}

export function useAiValidation(entityType: "call" | "contact" | "task" | "message") {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const mutation = useRequestAiValidation();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const validate = useCallback((data: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      mutation.mutate(
        { data: { entityType, data } },
        {
          onSuccess: (res) => setResult(res),
          onError: () => setResult(null),
        }
      );
    }, 800);
  }, [entityType]);

  const clear = useCallback(() => {
    setResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return {
    validate,
    clear,
    result,
    isValidating: mutation.isPending,
  };
}
