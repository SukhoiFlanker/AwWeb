"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [me, setMe] = useState<{ isAuthed: boolean; isAdmin: boolean; email: string | null }>({
    isAuthed: false,
    isAdmin: false,
    email: null,
  });

  useEffect(() => {
    async function refreshMe() {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;

        if (!token) {
          setMe({ isAuthed: false, isAdmin: false, email: null });
          return;
        }

        const r = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        setMe({
          isAuthed: !!j.isAuthed,
          isAdmin: !!j.isAdmin,
          email: j.email ?? null,
        });
      } catch {
        setMe({ isAuthed: false, isAdmin: false, email: null });
      }
    }

    refreshMe();

    const { data: listener } = supabase.auth.onAuthStateChange(async () => {
      await refreshMe();
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">个人网站</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            入口页（AI 对话、留言系统与管理后台）。
          </p>
        </header>

        <nav className="grid gap-3 sm:grid-cols-3">
          <Link
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            href="/chat"
          >
            <div className="font-medium">/chat</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">AI 对话</div>
          </Link>

          <Link
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            href="/feedback"
          >
            <div className="font-medium">/feedback</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">留言</div>
          </Link>

          {!me.isAuthed ? (
            <Link
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              href="/login"
            >
              <div className="font-medium">/login</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">登录 / 注册</div>
            </Link>
          ) : me.isAdmin ? (
            <Link
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              href="/admin/posts"
            >
              <div className="font-medium">/admin/posts</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">管理后台</div>
            </Link>
          ) : (
            <Link
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              href="/me"
            >
              <div className="font-medium">/me</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">我的账号</div>
            </Link>
          )}
        </nav>
      </main>
    </div>
  );
}