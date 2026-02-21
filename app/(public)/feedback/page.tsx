export default function FeedbackPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">留言</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        这里将通过服务端 Route Handler 写入 Supabase（禁止前端直连写库）。
      </p>
    </main>
  );
}
