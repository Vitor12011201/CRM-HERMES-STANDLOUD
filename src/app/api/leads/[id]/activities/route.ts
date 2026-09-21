import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { ServiceNotFoundError } from "@/lib/services/errors";
import { addLeadActivity } from "@/lib/services/leads";
import { activitySchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id: leadId } = await params;
  const parsed = activitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const { result } = await addLeadActivity(leadId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    return NextResponse.json({ error: "Não foi possível registrar a atividade." }, { status: 500 });
  }
}
