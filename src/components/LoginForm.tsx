"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Não foi possível iniciar a sessão.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Não foi possível iniciar a sessão.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="panel-pad w-full max-w-sm" onSubmit={handleSubmit}>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Entrar no CRM</h1>
      <p className="mt-1 text-sm text-muted">Acesso privado da STANDLOUD.</p>
      <div className="mt-6">
        <label className="field-label" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" className="field" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isSubmitting} />
      </div>
      {error && <p className="mt-3 text-sm font-medium text-red-700" role="alert">{error}</p>}
      <button type="submit" className="button-primary mt-6 w-full" disabled={isSubmitting}>{isSubmitting ? "Entrando..." : "Entrar"}</button>
    </form>
  );
}
