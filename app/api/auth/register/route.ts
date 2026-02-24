import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(pw: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/.test(pw);
}

function isValidUsername(name: string) {
  return /^[A-Za-z0-9_]{2,20}$/.test(name);
}

function hashCode(code: string) {
  const secret = process.env.EMAIL_CODE_SECRET ?? "";
  return crypto.createHash("sha256").update(code + secret).digest("hex");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const emailRaw = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const usernameRaw = typeof body.username === "string" ? body.username : "";

  const email = normalizeEmail(emailRaw);
  const username = usernameRaw.trim();
  const usernameLower = username.toLowerCase();

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "邮箱格式不正确" }, { status: 400 });
  }
  if (!code || code.length < 4) {
    return NextResponse.json({ ok: false, error: "验证码不正确" }, { status: 400 });
  }
  if (!isValidPassword(password)) {
    return NextResponse.json({ ok: false, error: "密码至少6位，且必须包含字母与数字" }, { status: 400 });
  }
  if (!isValidUsername(username)) {
    return NextResponse.json({ ok: false, error: "用户名仅支持字母/数字/下划线，长度2-20" }, { status: 400 });
  }

  const admin = createSupabaseServiceRoleClient();

  const { data: existingUser } = await admin.auth.admin.getUserByEmail(email);
  if (existingUser?.user) {
    return NextResponse.json({ ok: false, error: "该邮箱已注册" }, { status: 409 });
  }

  const { data: existingName } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("username_lower", usernameLower)
    .maybeSingle();

  if (existingName?.user_id) {
    return NextResponse.json({ ok: false, error: "用户名已被占用" }, { status: 409 });
  }

  const { data: verif } = await admin
    .from("email_verifications")
    .select("code_hash, expires_at, attempts")
    .eq("email", email)
    .maybeSingle();

  if (!verif) {
    return NextResponse.json({ ok: false, error: "请先获取验证码" }, { status: 400 });
  }

  if (verif.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ ok: false, error: "验证码尝试次数过多，请稍后再试" }, { status: 429 });
  }

  const expiresAt = new Date(verif.expires_at).getTime();
  if (Date.now() > expiresAt) {
    return NextResponse.json({ ok: false, error: "验证码已过期" }, { status: 400 });
  }

  const codeHash = hashCode(code);
  if (codeHash !== verif.code_hash) {
    await admin
      .from("email_verifications")
      .update({ attempts: verif.attempts + 1 })
      .eq("email", email);
    return NextResponse.json({ ok: false, error: "验证码不正确" }, { status: 400 });
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: username },
  });

  if (createErr || !created?.user) {
    return NextResponse.json({ ok: false, error: createErr?.message ?? "注册失败" }, { status: 400 });
  }

  const { error: profileErr } = await admin.from("user_profiles").insert({
    user_id: created.user.id,
    username,
    username_lower: usernameLower,
  });

  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ ok: false, error: "用户名已被占用" }, { status: 409 });
  }

  await admin.from("email_verifications").delete().eq("email", email);

  return NextResponse.json({ ok: true }, { status: 200 });
}
