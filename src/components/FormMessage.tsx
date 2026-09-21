export function FormMessage({ message, kind = "error" }: { message?: string; kind?: "error" | "success" }) {
  if (!message) return null;
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{message}</p>;
}

export function FieldError({ errors, name }: { errors: Record<string, string[] | undefined>; name: string }) {
  const error = errors[name]?.[0];
  return error ? <p className="mt-1 text-xs text-red-700" role="alert">{error}</p> : null;
}
