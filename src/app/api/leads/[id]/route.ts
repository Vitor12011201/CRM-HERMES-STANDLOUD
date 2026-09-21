import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { db } from "@/lib/db";
import { leadSchema } from "@/lib/validation";
import { leadStatusLabels } from "@/lib/lead";
import { addLeadActivity } from "@/lib/services/leads";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });

  const current = await db.lead.findUnique({ where: { id }, select: { status: true } });
  if (!current) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });

  if (current.status !== parsed.data.status) {
    // The D1 Prisma adapter currently does not provide transaction guarantees.
    // Persist the primary edit first, then write its audit activity.
    const lead = await db.lead.update({ where: { id }, data: parsed.data });
    await addLeadActivity(id, { type: "STATUS_CHANGE", note: `Status alterado de ${leadStatusLabels[current.status]} para ${leadStatusLabels[parsed.data.status]}.` });
    return NextResponse.json({ lead });
  }
  const lead = await db.lead.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ lead });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  try {
    await db.lead.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  }
}
