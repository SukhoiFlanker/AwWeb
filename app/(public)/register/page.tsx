"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(pw: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/.test(pw);
}

function isValidUsername(name: string) {
  return /^[A-Za-z0-9_]{2,20}$/.test(name);
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendCode() {
    setNotice(null);
    if (!isValidEmail(email.trim())) {
      setNotice("邮箱格式不正确");
      return;
    }

    setSending(true);
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setNotice(j.error ?? "发送失败");
        return;
      }
      if (j.devCode) {
        setNotice(`验证码已发送（开发模式）：${j.devCode}`);
      } else {
        setNotice("验证码已发送");
      }
      setCooldown(60);
    } catch (e: any) {
      setNotice(`发送失败：${e?.message ?? String(e)}`);
    } finally {
      setSending(false);
    }
  }

  async function register() {
    setNotice(null);
    if (!isValidEmail(email.trim())) {
      setNotice("邮箱格式不正确");
      return;
    }
    if (!code.trim()) {
      setNotice("请输入验证码");
      return;
    }
    if (!isValidPassword(password)) {
      setNotice("密码至少6位，且必须包含字母与数字");
      return;
    }
    if (!isValidUsername(username.trim())) {
      setNotice("用户名仅支持字母/数字/下划线，长度2-20");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password, username }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setNotice(j.error ?? "注册失败");
        return;
      }
      setNotice("注册成功，跳转登录...");
      router.replace("/login");
    } catch (e: any) {
      setNotice(`注册失败：${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">注册</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        邮箱注册需要验证码。密码至少6位，且必须包含字母与数字。
      </p>

      <div className="grid gap-3">
        <input
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-black"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          autoComplete="email"
        />

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-black"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="验证码"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={sending || cooldown > 0}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
          >
            {cooldown > 0 ? `重新发送(${cooldown}s)` : sending ? "发送中..." : "发送验证码"}
          </button>
        </div>

        <input
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-black"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少6位，字母+数字）"
          type="password"
          autoComplete="new-password"
        />

        <input
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-black"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名（字母/数字/下划线）"
          autoComplete="username"
        />

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={register}
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
          >
            {loading ? "处理中..." : "注册"}
          </button>
          <Link
            href="/login"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            已有账号？去登录
          </Link>
        </div>

        {notice && <p className="text-sm text-red-600 dark:text-red-400">{notice}</p>}
      </div>
    </main>
  );
}
