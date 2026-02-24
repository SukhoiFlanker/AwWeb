import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const FeedbackBodySchema = z.object({
  name: z.string().trim().optional(),
  email: z.string().trim().optional(),
  message: z.string().trim().min(1),
  pagePath: z.string().trim().optional(),
});

function pickClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return null;
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null);
    const parsedBody = FeedbackBodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body", issues: parsedBody.error.issues },
        { status: 400 }
      );
    }
    const body = parsedBody.data;

    const message = body.message;
    const name = body.name ?? null;
    const email = body.email ?? null;
    const page_path = body.pagePath ?? null;

    const user_agent = req.headers.get("user-agent");
    const ip = pickClientIp(req);

    // 1) 用 SSR client 读登录态（cookie session）
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const auth_email = u.user?.email ?? null;

    // 2) 用 service role client 写库（保证 .from 一定存在 + 绕过 RLS）
    const svc = createSupabaseServiceRoleClient();
    const { error } = await svc.from("feedback").insert({
      name: name ?? (auth_email ? auth_email.split("@")[0] : null),
      email: email ?? auth_email,
      message,
      page_path,
      user_agent,
      ip,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
