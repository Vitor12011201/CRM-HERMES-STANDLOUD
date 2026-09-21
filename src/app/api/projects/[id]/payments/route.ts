import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { db } from "@/lib/db";
import { paymentSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id: projectId } = await params;
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const project = await db.project.findUnique({ where: { id: projectId }, include: { payments: true } });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
  const received = project.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (received + parsed.data.amountCents > project.totalAmountCents) {
    return NextResponse.json({ error: "O pagamento ultrapassa o valor contratado do projeto." }, { status: 400 });
  }
  const payment = await db.payment.create({ data: { projectId, ...parsed.data } });
  return NextResponse.json({ payment }, { status: 201 });
}
