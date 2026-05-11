interface ZodIssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}

interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
}

export interface ZodErrorResponse {
  error: string;
  issues: Array<{ path: string; message: string }>;
}

export function zodErrorResponse(err: ZodErrorLike): ZodErrorResponse {
  return {
    error: "Requete invalide.",
    issues: err.issues.map((i) => ({
      path: i.path.map((p) => String(p)).join("."),
      message: i.message,
    })),
  };
}
