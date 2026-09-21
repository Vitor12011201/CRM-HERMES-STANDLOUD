import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { ServiceNotFoundError } from "@/lib/services/errors";
import { upsertLeadAnalysis } from "@/lib/services/lead-research";
import { leadAnalysisSchema } from "@/lib/validation";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = leadAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os campos da análise.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const analysis = await upsertLeadAnalysis(id, parsed.data, { updatedBy: "USER" });
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    return NextResponse.json({ error: "Não foi possível salvar a análise." }, { status: 500 });
  }
}
