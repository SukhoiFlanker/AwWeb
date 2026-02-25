import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const CODE_TTL_MINUTES = 10;
const COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashCode(code: string) {
  const secret = process.env.EMAIL_CODE_SECRET ?? "";
  return crypto.createHash("sha256").update(code + secret).digest("hex");
}

async function sendEmailWithResend(to: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return { ok: false as const, reason: "missing_resend_env" as const };

  const subject = "验证码";
  const text = `你的验证码是 ${code}，${CODE_TTL_MINUTES} 分钟内有效。`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    return { ok: false as const, reason: `resend_error:${msg}` as const };
  }

  return { ok: true as const };
}

async function findUserByEmail(admin: ReturnType<typeof createSupabaseServiceRoleClient>, email: string) {
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;

    if (users.length < perPage) return null;
    page += 1;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({ email: "" }));
  const emailRaw = typeof body.email === "string" ? body.email : "";
  const email = normalizeEmail(emailRaw);

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "邮箱格式不正确" }, { status: 400 });
  }

  const admin = createSupabaseServiceRoleClient();

  const existingUser = await findUserByEmail(admin, email);
  if (existingUser) {
    return NextResponse.json({ ok: false, error: "该邮箱已注册" }, { status: 409 });
  }

  const { data: existingCode } = await admin
    .from("email_verifications")
    .select("last_sent_at, attempts")
    .eq("email", email)
    .maybeSingle();

  if (existingCode?.last_sent_at) {
    const last = new Date(existingCode.last_sent_at).getTime();
    if (Date.now() - last < COOLDOWN_SECONDS * 1000) {
      return NextResponse.json({ ok: false, error: "请求过于频繁，请稍后再试" }, { status: 429 });
    }
  }

  if ((existingCode?.attempts ?? 0) >= MAX_ATTEMPTS) {
    return NextResponse.json({ ok: false, error: "验证码尝试次数过多，请稍后再试" }, { status: 429 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: upsertErr } = await admin.from("email_verifications").upsert({
    email,
    code_hash: codeHash,
    expires_at: expiresAt,
    attempts: 0,
    last_sent_at: new Date().toISOString(),
  });

  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  const sendRes = await sendEmailWithResend(email, code);
  if (!sendRes.ok) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ok: true, devCode: code }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: "验证码发送失败，请联系管理员" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
