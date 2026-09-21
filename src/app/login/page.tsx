import { redirect } from "next/navigation";
import { hasWebSession } from "@/lib/auth/server";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  if (await hasWebSession()) redirect("/dashboard");
  return <LoginForm />;
}
