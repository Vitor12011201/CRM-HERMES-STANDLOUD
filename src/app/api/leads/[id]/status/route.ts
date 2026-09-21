import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { LeadStatus } from "@/generated/prisma/enums";
import { ServiceNotFoundError } from "@/lib/services/errors";
import { setLeadStatus } from "@/lib/services/leads";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (!Object.values(LeadStatus).includes(status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }
  try {
    const { result } = await setLeadStatus(id, status);
    return NextResponse.json({ status: result.status });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    return NextResponse.json({ error: "Não foi possível alterar o status." }, { status: 500 });
  }
}
