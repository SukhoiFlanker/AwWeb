import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PostSource = "feedback" | "chat";

export type AdminPost = {
  id: string; // `${source}:${source_ref_id}`
  created_at: string;
  author: { user_id?: string | null; name?: string | null; email?: string | null };
  content: string;
  source: PostSource;
  source_ref_id: string;
  parent_id: string | null;
  deleted: boolean;
};

type AdminUserGroup = {
  key: string;
  author: { user_id?: string | null; name?: string | null; email?: string | null };
  counts: { active: number; deleted: number };
};

type AdminPostsViewRow = {
  id: string;
  created_at: string;
  content: string;
  author_user_id: string | null;
  author_name: string | null;
  parent_id: string | null;
  root_id: string | null;
  status: string | null;
  deleted_at: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function parseIntParam(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function parseGlobalId(id: string): { source: PostSource; source_ref_id: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) {
    if (isUuidLike(id)) return { source: "feedback", source_ref_id: id };
    return null;
  }
  const source = id.slice(0, idx) as PostSource;
  const source_ref_id = id.slice(idx + 1);
  if (source !== "feedback" && source !== "chat") return null;
  if (!isUuidLike(source_ref_id)) return null;
  return { source, source_ref_id };
}

async function requireAdminFromRequest(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    const sb = supabaseServer();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return { ok: false as const, status: 401 as const, error: "Unauthorized" };
    }
    const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();
    const email = (userData.user.email || "").toLowerCase();
    if (email !== adminEmail) {
      return { ok: false as const, status: 403 as const, error: "Forbidden (not admin)" };
    }
    return { ok: true as const };
  }

  const url = requireEnv("SUPABASE_URL");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401 as const, error: "Invalid token" };
  }

  const email = (userData.user.email || "").toLowerCase();
  if (email !== adminEmail) {
    return { ok: false as const, status: 403 as const, error: "Forbidden (not admin)" };
  }

  return { ok: true as const };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminFromRequest(req);
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
    }

    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q");
    const q = qRaw && qRaw.trim() ? qRaw.trim() : null;
    const userParamRaw = url.searchParams.get("user");
    const userParam = userParamRaw && userParamRaw.trim() ? userParamRaw.trim() : null;

    const deleted = false;

    const page = Math.max(1, parseIntParam(url.searchParams.get("page"), 1));
    const pageSize = Math.min(100, Math.max(1, parseIntParam(url.searchParams.get("pageSize"), 30)));
    const offset = (page - 1) * pageSize;

    const adminDb = createSupabaseServiceRoleClient();

    const users: AdminUserGroup[] = [];

    let qb = adminDb
      .from("guestbook_entries")
      .select("id, created_at, author_user_id, author_name, content, parent_id, root_id, status, deleted_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (q) qb = qb.ilike("content", `%${q}%`);
    if (userParam) {
      if (userParam === "anonymous") qb = qb.is("author_user_id", null);
      else qb = qb.eq("author_user_id", userParam);
    }
    if (!deleted) {
      qb = qb.neq("status", "deleted").is("deleted_at", null);
    }

    const { data: rows, error: listErr, count } = await qb;
    if (listErr) {
      return NextResponse.json({ success: false, error: listErr.message }, { status: 500 });
    }

    const { data: deletedRows } = await adminDb
      .from("guestbook_entries")
      .select("id")
      .or("status.eq.deleted,deleted_at.not.is.null")
      .limit(5000);
    const deletedSet = new Set((deletedRows || []).map((r: any) => r.id));

    const filtered = (rows || []).filter((r: AdminPostsViewRow) => {
      if (deletedSet.has(r.id)) return false;
      if (r.parent_id && deletedSet.has(r.parent_id)) return false;
      if (r.root_id && deletedSet.has(r.root_id)) return false;
      return true;
    });

    const items: AdminPost[] = filtered.map((r: AdminPostsViewRow) => ({
      id: `feedback:${r.id}`,
      created_at: r.created_at,
      author: { user_id: r.author_user_id, name: r.author_name, email: null },
      content: r.content,
      source: "feedback",
      source_ref_id: r.id,
      parent_id: r.parent_id,
      deleted: r.status === "deleted" || Boolean(r.deleted_at),
    }));

    return NextResponse.json({
      success: true,
      users,
      items,
      page,
      pageSize,
      total: typeof count === "number" ? count : 0,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdminFromRequest(req);
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
    }

    const body = (await req.json().catch(() => null)) as { id?: string; deleted?: boolean } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const deleted = Boolean(body?.deleted);
    const parsed = parseGlobalId(id);
    if (!parsed) {
      return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
    }

    const adminDb = createSupabaseServiceRoleClient();

    if (parsed.source === "feedback") {
      const { error } = await adminDb
        .from("guestbook_entries")
        .update(deleted ? { status: "deleted", deleted_at: new Date().toISOString() } : { status: "active", deleted_at: null })
        .eq("id", parsed.source_ref_id);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (deleted) {
      const { error } = await adminDb.from("admin_post_tombstones").upsert(
        {
          source: parsed.source,
          source_ref_id: parsed.source_ref_id,
          deleted_at: new Date().toISOString(),
        },
        { onConflict: "source,source_ref_id" }
      );
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    const { error } = await adminDb
      .from("admin_post_tombstones")
      .delete()
      .eq("source", parsed.source)
      .eq("source_ref_id", parsed.source_ref_id);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
