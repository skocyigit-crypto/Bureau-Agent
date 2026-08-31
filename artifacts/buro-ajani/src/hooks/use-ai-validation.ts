import { useRequestAiValidation } from "@workspace/api-client-react";
import { useCallback,useRef,useState } from "react";

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
  /**
   * Numero de la derniere demande envoyee.
   *
   * L'anti-rebond n'empeche pas deux requetes d'etre en vol: il suffit que la
   * personne tape, marque une pause de 800 ms, puis reprenne. Si la premiere
   * reponse revient apres la seconde, elle ecrasait le resultat: on affichait
   * alors une validation portant sur un texte que la personne avait deja
   * modifie. Seule la reponse de la demande la plus recente est retenue.
   */
  const latestRef = useRef(0);

  const validate = useCallback((data: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const seq = ++latestRef.current;
      mutation.mutate(
        { data: { entityType, data } },
        {
          onSuccess: (res) => {
            if (seq === latestRef.current) setResult(res);
          },
          onError: () => {
            if (seq === latestRef.current) setResult(null);
          },
        }
      );
    }, 800);
  }, [entityType]);

  const clear = useCallback(() => {
    setResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Invalide aussi les reponses en vol: sans cela, une requete partie avant
    // l'effacement viendrait repeupler un resultat que l'on vient de vider.
    latestRef.current++;
  }, []);

  return {
    validate,
    clear,
    result,
    isValidating: mutation.isPending,
  };
}
