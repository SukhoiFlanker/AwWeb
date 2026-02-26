"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [me, setMe] = useState<{ isAuthed: boolean; isAdmin: boolean; email: string | null }>({
    isAuthed: false,
    isAdmin: false,
    email: null,
  });

  useEffect(() => {
    async function refreshMe() {
      try {
        const r = await fetch("/api/me", { cache: "no-store", credentials: "include" });
        const j = await r.json();
        setMe({ isAuthed: !!j.isAuthed, isAdmin: !!j.isAdmin, email: j.email ?? null });
      } catch {
        setMe({ isAuthed: false, isAdmin: false, email: null });
      }
    }

    refreshMe();
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 12% 8%, rgba(239, 68, 68, 0.22), transparent 60%), radial-gradient(50% 40% at 90% 15%, rgba(248, 113, 113, 0.18), transparent 60%), radial-gradient(50% 50% at 50% 90%, rgba(255, 255, 255, 0.08), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16">
        <header className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div />
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div className="grid gap-4" />

          <div className="flex flex-col gap-4" style={{ transform: "translateY(80px)" }}>
            {!me.isAuthed ? (
              <Link
                href="/login"
                className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:-translate-y-1 hover:border-slate-500/70 hover:bg-slate-900/80"
              >
                <div className="text-xs text-slate-400">身份入口</div>
                <div className="mt-3 text-lg font-semibold text-slate-100">登录 / 注册</div>
                <div className="mt-2 text-sm text-slate-300">绑定身份，解锁私有对话。</div>
              </Link>
            ) : me.isAdmin ? (
              <Link
                href="/admin/posts"
                className="group rounded-2xl border border-red-500/50 bg-red-500/10 p-5 transition hover:-translate-y-1 hover:border-red-400/70 hover:bg-red-500/20"
              >
                <div className="text-xs text-red-200">管理员</div>
                <div className="mt-3 text-lg font-semibold text-red-100">管理中枢</div>
                <div className="mt-2 text-sm text-red-100/80">审核留言、查看聊天记录。</div>
              </Link>
            ) : (
              <Link
                href="/me"
                className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:-translate-y-1 hover:border-slate-500/70 hover:bg-slate-900/80"
              >
                <div className="text-xs text-slate-400">个人中心</div>
                <div className="mt-3 text-lg font-semibold text-slate-100">个人中心</div>
                <div className="mt-2 text-sm text-slate-300">查看资料与通知。</div>
              </Link>
            )}

            <Link
              href="/chat"
              className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:-translate-y-1 hover:border-red-500/60 hover:bg-slate-900/80"
            >
              <div className="text-xs text-slate-400">智能对话</div>
              <div className="mt-3 text-lg font-semibold text-slate-100">多模型 · 流式生成</div>
              <div className="mt-2 text-sm text-slate-300">在一个入口里切换本地与免费模型。</div>
            </Link>

            <Link
              href="/feedback"
              className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:-translate-y-1 hover:border-red-500/60 hover:bg-slate-900/80"
            >
              <div className="text-xs text-slate-400">反馈中心</div>
              <div className="mt-3 text-lg font-semibold text-slate-100">评论树 · 通知</div>
              <div className="mt-2 text-sm text-slate-300">支持回复、点赞点踩与公告栏。</div>
            </Link>
          </div>
        </section>

      </main>

      <style jsx>{`
        @keyframes float {
          0% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-6px);
          }
          100% {
            transform: translateY(0px);
          }
        }
      `}</style>
    </div>
  );
}
