import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { projectSchema } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const parsed = projectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const db = getDb();
  const project = await db.project.findUnique({ where: { id }, include: { payments: true } });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
  if (parsed.data.leadId) {
    const lead = await db.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true } });
    if (!lead) return NextResponse.json({ error: "Lead vinculado não encontrado." }, { status: 400 });
  }
  const received = project.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (parsed.data.totalAmountCents < received) return NextResponse.json({ error: "O valor contratado não pode ser menor que o total já recebido." }, { status: 400 });
  const updated = await db.project.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ project: updated });
}
