import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { leadSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os campos destacados.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const db = getDb();
  const lead = await db.lead.create({ data: parsed.data });
  return NextResponse.json({ lead }, { status: 201 });
}
