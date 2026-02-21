import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type FeedbackBody = {
  name?: string;
  email?: string;
  message?: string;
  pagePath?: string;
};

function pickClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as FeedbackBody | null;
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const email = typeof body.email === "string" ? body.email.trim() : null;
    const page_path =
      typeof body.pagePath === "string" ? body.pagePath.trim() : null;

    if (!message) {
      return NextResponse.json(
        { success: false, error: "message is required" },
        { status: 400 }
      );
    }

    const user_agent = req.headers.get("user-agent");
    const ip = pickClientIp(req);

    const supabase = createSupabaseServerClient();

    const { error } = await supabase.from("feedback").insert({
      name,
      email,
      message,
      page_path,
      user_agent,
      ip,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
