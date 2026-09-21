import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { ServiceNotFoundError } from "@/lib/services/errors";
import { addLeadEvidence } from "@/lib/services/lead-research";
import { leadEvidenceSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = leadEvidenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os campos da evidência.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const evidence = await addLeadEvidence(id, parsed.data, { capturedBy: "USER" });
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    return NextResponse.json({ error: "Não foi possível registrar a evidência." }, { status: 500 });
  }
}
