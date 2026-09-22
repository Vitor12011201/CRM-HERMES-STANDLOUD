import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { projectSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const parsed = projectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const db = getDb();
  if (parsed.data.leadId) {
    const lead = await db.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true } });
    if (!lead) return NextResponse.json({ error: "Lead vinculado não encontrado." }, { status: 400 });
  }
  const project = await db.project.create({ data: parsed.data });
  return NextResponse.json({ project }, { status: 201 });
}
