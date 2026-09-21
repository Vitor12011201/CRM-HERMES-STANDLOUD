import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/server";

export default async function Home() {
  await requirePageSession();
  redirect("/dashboard");
}
