import { NextResponse } from "next/server";
import { getAvailableModels } from "@/lib/chat/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const models = getAvailableModels().map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
  }));
  return NextResponse.json({ success: true, models });
}
