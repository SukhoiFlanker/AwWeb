import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">注册</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        当前仓库尚未启用公开注册流程，请联系管理员开通账号。
      </p>
      <div className="pt-2">
        <Link
          href="/"
          className="inline-flex rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
