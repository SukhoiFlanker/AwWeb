import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">个人网站</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            入口页（后续接入 AI 对话、留言系统与管理后台）。
          </p>
        </header>

        <nav className="grid gap-3 sm:grid-cols-3">
          <Link
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            href="/chat"
          >
            <div className="font-medium">/chat</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              AI 对话
            </div>
          </Link>
          <Link
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            href="/feedback"
          >
            <div className="font-medium">/feedback</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              留言
            </div>
          </Link>
          <Link
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            href="/admin"
          >
            <div className="font-medium">/admin</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              管理后台
            </div>
          </Link>
        </nav>
      </main>
    </div>
  );
}
