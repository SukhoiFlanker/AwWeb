import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireVisitorKey } from "@/lib/guestbook/visitor";

const BodySchema = z.object({
  entryId: z.string().uuid(),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export async function POST(req: Request) {
  try {
    const visitorKey = requireVisitorKey(req);
    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { entryId, value } = parsed.data;

    const { data: entry, error: eErr } = await supabase
      .from("guestbook_entries")
      .select("id, deleted_at")
      .eq("id", entryId)
      .maybeSingle();

    if (eErr) {
      return NextResponse.json({ success: false, error: eErr.message }, { status: 500 });
    }
    if (!entry) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    if ((entry as { deleted_at?: string | null }).deleted_at) {
      return NextResponse.json(
        { success: false, error: "Cannot react to deleted entry" },
        { status: 400 }
      );
    }

    if (value === 0) {
      const { error } = await supabase
        .from("guestbook_reactions")
        .delete()
        .eq("entry_id", entryId)
        .eq("user_key", visitorKey);

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from("guestbook_reactions")
      .upsert(
        { entry_id: entryId, user_key: visitorKey, value },
        { onConflict: "entry_id,user_key" }
      );

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("x-visitor-id") ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
