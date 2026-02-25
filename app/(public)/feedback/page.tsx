"use client";

import { useId } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { guestbookFetch } from "@/lib/guestbook/client";

type GuestbookEntry = {
  id: string;
  createdAt: string;
  parentId: string | null;
  rootId?: string | null;
  depth?: number;
  replyToUserId?: string | null;
  replyToName?: string | null;
  authorName: string | null;
  authorIsAdmin?: boolean;
  content: string;
  contentType: "plain" | "md" | string;
  deleted: boolean;
  mine: boolean;
  stats: {
    like: number;
    dislike: number;
    myReaction: -1 | 0 | 1;
    commentCount?: number;
  };
  children?: GuestbookEntry[];
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function miniMarkdownToHtml(input: string): string {
  const text = escapeHtml(input);

  const codeBlocks: string[] = [];
  const withCodePlaceholders = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.push(code) - 1;
    return `@@CODEBLOCK_${idx}@@`;
  });

  const inline = withCodePlaceholders
    .replace(/`([^`]+)`/g, (_m, code) => `<code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900">${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`)
    .replace(/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => {
      return `<a class="underline underline-offset-4" href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    });

  const paragraphs = inline
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="leading-6">${p.replaceAll("\n", "<br/>")}</p>`)
    .join("");

  const restored = paragraphs.replace(/@@CODEBLOCK_(\d+)@@/g, (_m, i) => {
    const code = codeBlocks[Number(i)] ?? "";
    return `<pre class="mt-3 overflow-auto rounded-lg bg-zinc-950 p-3 text-zinc-50"><code>${code}</code></pre>`;
  });

  return restored || `<p class="text-zinc-500 dark:text-zinc-400">（空）</p>`;
}

function ReactionButton(props: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition",
        props.active
          ? "border-zinc-900 bg-zinc-900 text-white ring-2 ring-zinc-900/30 dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
      ].join(" ")}
    >
      <span>{props.label}</span>
      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{props.count}</span>
      {props.active && <span className="text-xs text-zinc-200 dark:text-zinc-800">已选</span>}
    </button>
  );
}

function Editor(props: {
  placeholder: string;
  submitLabel: string;
  compact?: boolean;
  onSubmit: (p: { content: string; contentType: "plain" | "md" }) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState<"plain" | "md">("md");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(!props.compact);

  const textareaId = useId();

  function applyMd(action: "bold" | "italic" | "code" | "quote" | "ul" | "link" | "h2" | "codeblock" | "table") {
    if (contentType !== "md") return;
    const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!el) return;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = content.slice(start, end);

    const wrap = (left: string, right = left) => {
      const next = content.slice(0, start) + left + selected + right + content.slice(end);
      setContent(next);
      queueMicrotask(() => {
        el.focus();
        const cursorStart = start + left.length;
        const cursorEnd = cursorStart + selected.length;
        el.setSelectionRange(cursorStart, cursorEnd);
      });
    };

    if (action === "bold") return wrap("**", "**");
    if (action === "italic") return wrap("*", "*");
    if (action === "code") return wrap("`", "`");
    if (action === "h2") return wrap("## ", "");
    if (action === "quote") return wrap("> ", "");
    if (action === "ul") return wrap("- ", "");
    if (action === "codeblock") {
      const lang = selected ? "" : "javascript";
      return wrap("```" + lang + "\n", "\n```");
    }
    if (action === "table") {
      const table = "| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |";
      const next = content.slice(0, start) + table + content.slice(end);
      setContent(next);
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(start + table.length, start + table.length);
      });
      return;
    }
    if (action === "link") {
      const label = selected || "链接文字";
      const left = `[${label}](`;
      const right = "https://)";
      const next = content.slice(0, start) + left + right + content.slice(end);
      setContent(next);
      queueMicrotask(() => {
        el.focus();
        const urlStart = start + left.length;
        const urlEnd = urlStart + "https://".length;
        el.setSelectionRange(urlStart, urlEnd);
      });
      return;
    }
  }

  function insertText(text: string) {
    const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!el) {
      setContent((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    queueMicrotask(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    const text = await file.text().catch(() => "");
    if (text) setContent(text.slice(0, 5000));
  }

  async function submit() {
    setNotice(null);
    const msg = content.trim();
    if (!msg) {
      setNotice("请输入内容");
      return;
    }
    setLoading(true);
    try {
      await props.onSubmit({ content: msg, contentType });
      setContent("");
      setNotice("已发送");
      setTimeout(() => setNotice(null), 1200);
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : "发送失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">格式</label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value === "plain" ? "plain" : "md")}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-black"
          >
            <option value="md">Markdown</option>
            <option value="plain">纯文本</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="ml-auto rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
        >
          {showPreview ? "隐藏预览" : "显示预览"}
        </button>
      </div>

      <div className={["mt-3 grid gap-3", showPreview ? "md:grid-cols-2" : ""].join(" ")}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-base">
            {["😀", "😂", "😍", "👍", "🎉", "😢", "😡", "🔥"].map((emo) => (
              <button
                key={emo}
                type="button"
                onClick={() => insertText(emo)}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                {emo}
              </button>
            ))}
          </div>
          {contentType === "md" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyMd("bold")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                加粗
              </button>
              <button
                type="button"
                onClick={() => applyMd("italic")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                斜体
              </button>
              <button
                type="button"
                onClick={() => applyMd("code")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                行内代码
              </button>
              <button
                type="button"
                onClick={() => applyMd("codeblock")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                代码块
              </button>
              <button
                type="button"
                onClick={() => applyMd("link")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                链接
              </button>
              <button
                type="button"
                onClick={() => applyMd("table")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                表格
              </button>
              <button
                type="button"
                onClick={() => applyMd("quote")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                引用
              </button>
              <button
                type="button"
                onClick={() => applyMd("ul")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                列表
              </button>
              <button
                type="button"
                onClick={() => applyMd("h2")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                标题
              </button>
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                小提示：三反引号 ``` 可插入代码块
              </span>
            </div>
          )}
          <textarea
            id={textareaId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={props.placeholder}
            rows={props.compact ? 4 : 8}
            className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:focus:border-zinc-600"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900">
                从文件导入
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => setContent("")}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                清空
              </button>
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {content.length}/5000
            </div>
          </div>
        </div>

        {showPreview && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-black">
            {contentType === "md" ? (
              <div
                className="text-sm leading-6 text-zinc-900 dark:text-zinc-50"
                dangerouslySetInnerHTML={{ __html: miniMarkdownToHtml(content) }}
              />
            ) : (
              <pre className="whitespace-pre-wrap leading-6">{content || "（空）"}</pre>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
        >
          {loading ? "发送中..." : props.submitLabel}
        </button>
        {notice && <span className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</span>}
      </div>
    </section>
  );
}

function EntryCard(props: {
  entry: GuestbookEntry;
  onReact: (entryId: string, value: -1 | 0 | 1) => Promise<void>;
  onDelete: (entryId: string) => Promise<void>;
  onOpen: (entryId: string) => void;
  showOpen?: boolean;
  openLabel?: string;
}) {
  const e = props.entry;
  const showOpen = props.showOpen !== false;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className={["font-medium", e.authorIsAdmin ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"].join(" ")}>
            {e.authorName || "用户"}
          </span>
          {e.authorIsAdmin && (
            <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
              管理员
            </span>
          )}
          <span className="mx-2">·</span>
          <span>{formatTime(e.createdAt)}</span>
          {e.deleted && (
            <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-900">
              已删除
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {e.mine && !e.deleted && (
            <button
              type="button"
              onClick={() => props.onDelete(e.id)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:bg-black dark:text-red-400 dark:hover:bg-red-950/40"
            >
              删除
            </button>
          )}
          {showOpen && (
            <button
              type="button"
              onClick={() => props.onOpen(e.id)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              {props.openLabel ?? "查看评论"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {e.deleted ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">该评论已删除</p>
        ) : e.contentType === "md" ? (
          <div
            className="text-sm leading-6 text-zinc-900 dark:text-zinc-50"
            dangerouslySetInnerHTML={{
              __html: (e.replyToName ? `<p class="text-xs text-zinc-500 dark:text-zinc-400">回复 @${escapeHtml(e.replyToName)}</p>` : "") + miniMarkdownToHtml(e.content),
            }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-6">
            {e.replyToName ? `回复 @${e.replyToName}\n` : ""}{e.content}
          </pre>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ReactionButton
          active={e.stats.myReaction === 1}
          label="👍"
          count={e.stats.like}
          onClick={() => props.onReact(e.id, e.stats.myReaction === 1 ? 0 : 1)}
        />
        <ReactionButton
          active={e.stats.myReaction === -1}
          label="👎"
          count={e.stats.dislike}
          onClick={() => props.onReact(e.id, e.stats.myReaction === -1 ? 0 : -1)}
        />
        <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-400">
          互动 {e.stats.like + e.stats.dislike + (e.stats.commentCount ?? 0)}
        </span>
      </div>
    </article>
  );
}

export default function FeedbackPage() {
  const PAGE_SIZE = 10;
  const REPLY_PAGE_SIZE = 10;
  const [isAdmin, setIsAdmin] = useState(false);
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "mine">("all");

  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [replyMap, setReplyMap] = useState<Record<string, { items: GuestbookEntry[]; page: number; hasMore: boolean; loading: boolean; expanded: boolean }>>({});
  const [replyBoxOpen, setReplyBoxOpen] = useState<Record<string, boolean>>({});
  const [announcements, setAnnouncements] = useState<Array<{ id: string; created_at: string; author_name: string | null; author_is_admin: boolean; content: string; content_type: string }>>([]);
  const [announceSide, setAnnounceSide] = useState<"left" | "right">("right");
  const [announceCollapsed, setAnnounceCollapsed] = useState(false);
  const [announceContent, setAnnounceContent] = useState("");
  const [announceType, setAnnounceType] = useState<"plain" | "md">("md");

  function gotoLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
}

async function guardAuthOrThrow(res: Response, data: any) {
  if (res.status === 401) {
    setNotice("请先登录");
    gotoLogin();
    throw new Error("Unauthorized");
  }
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `请求失败（${res.status}）`);
  }
}

  const loadList = useCallback(async (nextPage = 1, append = false) => {
    setNotice(null);
    setLoading(true);
     try {
    const params = new URLSearchParams();

    // ✅ 仅拉 active
    params.set("status", "active");
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(nextPage));

    if (searchQuery.trim()) {
      params.set("search", searchQuery.trim());
    }

    const res = await guestbookFetch(`/api/guestbook?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `加载失败（${res.status}）`);
    }

    const list = (data.data ?? []) as GuestbookEntry[];
    setEntries((prev) => (append ? [...prev, ...list] : list));
    setHasMore(list.length === PAGE_SIZE);
    setPage(nextPage);

    // ✅ 3) 保存 counts（后端方案 A 返回的字段）
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "加载失败";
      if (
        msg.includes("guestbook_entries") ||
        msg.toLowerCase().includes("relation") ||
        msg.toLowerCase().includes("does not exist")
      ) {
        setNotice(
          "留言板表尚未创建：请先在 Supabase 执行 `SUPABASE_SCHEMA.sql` 的 Guestbook 段落。"
        );
      } else {
        setNotice(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, searchQuery]);

  async function loadReplies(parentId: string, reset = false) {
    setReplyMap((prev) => ({
      ...prev,
      [parentId]: {
        items: reset ? [] : prev[parentId]?.items ?? [],
        page: reset ? 1 : (prev[parentId]?.page ?? 1),
        hasMore: reset ? true : (prev[parentId]?.hasMore ?? true),
        loading: true,
        expanded: true,
      },
    }));

    const nextPage = reset ? 1 : (replyMap[parentId]?.page ?? 1);
    const params = new URLSearchParams();
    params.set("parentId", parentId);
    params.set("status", "active");
    params.set("limit", String(REPLY_PAGE_SIZE));
    params.set("page", String(nextPage));

    const res = await guestbookFetch(`/api/guestbook?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setNotice(data?.error || `加载失败（${res.status}）`);
      setReplyMap((prev) => ({
        ...prev,
        [parentId]: { ...(prev[parentId] ?? { items: [], page: 1, hasMore: false, expanded: true }), loading: false },
      }));
      return;
    }

    const list = (data.data ?? []) as GuestbookEntry[];
    setReplyMap((prev) => {
      const prevItems = reset ? [] : prev[parentId]?.items ?? [];
      return {
        ...prev,
        [parentId]: {
          items: [...prevItems, ...list],
          page: nextPage + 1,
          hasMore: list.length === REPLY_PAGE_SIZE,
          loading: false,
          expanded: true,
        },
      };
    });
  }

  function toggleReplies(parentId: string) {
    const cur = replyMap[parentId];
    if (cur?.expanded) {
      setReplyMap((prev) => ({
        ...prev,
        [parentId]: { ...(prev[parentId] ?? { items: [], page: 1, hasMore: false, loading: false }), expanded: false },
      }));
      return;
    }
    void loadReplies(parentId, cur?.items?.length ? false : true);
  }

  async function postRoot(p: { content: string; contentType: "plain" | "md" }) {
  const res = await guestbookFetch("/api/guestbook/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const data = await res.json().catch(() => ({}));
  await guardAuthOrThrow(res, data);
  await loadList(1, false);
}

  async function postComment(parentId: string, p: { content: string; contentType: "plain" | "md" }) {
  const res = await guestbookFetch("/api/guestbook/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, parentId }),
  });
  const data = await res.json().catch(() => ({}));
  await guardAuthOrThrow(res, data);

  await loadReplies(parentId, true);
  await loadList(1, false);
}

  async function react(entryId: string, value: -1 | 0 | 1) {
  const res = await guestbookFetch("/api/guestbook/reaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId, value }),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    setNotice("请先登录后再点赞/点踩");
    gotoLogin();
    return;
  }
  if (!res.ok || !data?.success) {
    setNotice(data?.error || `操作失败（${res.status}）`);
    return;
  }

  await loadList(1, false);
}

  async function del(entryId: string) {
  if (!confirm("确定删除这条留言吗？")) return;

  const res = await guestbookFetch(`/api/guestbook/entry/${entryId}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    setNotice("请先登录后再删除");
    gotoLogin();
    return;
  }
  if (!res.ok || !data?.success) {
    setNotice(data?.error || `删除失败（${res.status}）`);
    return;
  }

  await loadList(1, false);
}

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    setReplyMap({});
    setReplyBoxOpen({});
    void loadList(1, false);
  }, [loadList]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setIsAdmin(Boolean(data?.isAdmin));
    })();
  }, []);

  async function loadAnnouncements() {
    const res = await fetch("/api/feedback/announcements", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success) setAnnouncements(data.items ?? []);
  }

  async function postAnnouncement() {
    if (!announceContent.trim()) return;
    const res = await fetch("/api/feedback/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: announceContent, contentType: announceType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setNotice(data?.error || "公告发布失败");
      return;
    }
    setAnnounceContent("");
    await loadAnnouncements();
  }

  const visibleEntries = useMemo(() => {
    const base = entries.filter((e) => !e.deleted);
    if (mode === "all") return base;
    return base.filter((e) => e.mine);
  }, [entries, mode]);

  function renderReplies(parentId: string, depth: number) {
    const state = replyMap[parentId];
    if (!state?.expanded) return null;
    const items = state.items ?? [];

    return (
      <div className={depth > 0 ? "ml-6 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700" : "mt-3"}>
        {items.map((e) => (
          <div key={e.id} className="mt-3 space-y-2">
            <EntryCard entry={e} onReact={react} onDelete={del} onOpen={() => {}} showOpen={false} />
            <div className="flex items-center gap-2">
              {depth < 2 && (
                <button
                  type="button"
                  onClick={() => toggleReplies(e.id)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                >
                  {replyMap[e.id]?.expanded ? "收起回复" : `展开回复${e.stats.commentCount ? `(${e.stats.commentCount})` : ""}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setReplyBoxOpen((prev) => ({ ...prev, [e.id]: !prev[e.id] }))}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                {replyBoxOpen[e.id] ? "取消回复" : "回复"}
              </button>
            </div>

            {replyBoxOpen[e.id] && (
              <Editor
                compact
                placeholder={`回复 ${e.authorName || "用户"}...`}
                submitLabel="回复"
                onSubmit={(p) => postComment(e.id, p)}
              />
            )}

            {depth < 2 && renderReplies(e.id, depth + 1)}
          </div>
        ))}

        {state.loading && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">加载中...</p>
        )}
        {!state.loading && state.hasMore && (
          <button
            type="button"
            onClick={() => loadReplies(parentId, false)}
            className="mt-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
          >
            加载更多回复
          </button>
        )}
      </div>
    );
  }

  useEffect(() => {
    void loadAnnouncements();
  }, []);

  const sidebar = (
    <aside className="w-full max-w-xs">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2">
          <strong>公告</strong>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAnnounceSide((s) => (s === "left" ? "right" : "left"))}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              切换方向
            </button>
            <button
              type="button"
              onClick={() => setAnnounceCollapsed((v) => !v)}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              {announceCollapsed ? "展开" : "折叠"}
            </button>
          </div>
        </div>

        {!announceCollapsed && (
          <div className="mt-3 space-y-3">
            {isAdmin && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">格式</label>
                  <select
                    value={announceType}
                    onChange={(e) => setAnnounceType(e.target.value === "plain" ? "plain" : "md")}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                  >
                    <option value="md">Markdown</option>
                    <option value="plain">纯文本</option>
                  </select>
                </div>
                <textarea
                  value={announceContent}
                  onChange={(e) => setAnnounceContent(e.target.value)}
                  placeholder="发布公告..."
                  rows={4}
                  className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
                />
                <button
                  type="button"
                  onClick={postAnnouncement}
                  className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
                >
                  发布
                </button>
              </div>
            )}

            {announcements.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无公告</p>
            ) : (
              <ul className="space-y-3">
                {announcements.map((a) => (
                  <li key={a.id} className="rounded border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-black">
                    <div className="flex items-center justify-between gap-2">
                      <span className={a.author_is_admin ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"}>
                        {a.author_name || "管理员"}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {a.created_at ? new Date(a.created_at).toLocaleString() : "-"}
                      </span>
                    </div>
                    <div className="mt-2">
                      {a.content_type === "md" ? (
                        <div
                          className="leading-6"
                          dangerouslySetInnerHTML={{ __html: miniMarkdownToHtml(a.content) }}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap">{a.content}</pre>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className={["flex gap-6", announceSide === "left" ? "flex-row" : "flex-row-reverse"].join(" ")}>
        {sidebar}
        <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">留言板</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            留下评论，分享想法，交流反馈。支持 Markdown 格式，尽情发挥吧（请登录并保持礼貌）！
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadList(1, false)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("all")}
          className={[
            "rounded-full px-4 py-1.5 text-sm",
            mode === "all"
              ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-black"
              : "border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
          ].join(" ")}
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => setMode("mine")}
          className={[
            "rounded-full px-4 py-1.5 text-sm",
            mode === "mine"
              ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-black"
              : "border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
          ].join(" ")}
        >
          我的  
        </button>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索留言..."
          className="flex-1 min-w-48 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
        />
        <button
          type="button"
          onClick={() => loadList(1, false)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </div>

      <div className="mt-6">
        <Editor
          placeholder="写点什么吧（支持 Markdown；也可以从 .txt/.md 文件导入）"
          submitLabel="发布留言"
          onSubmit={postRoot}
        />
      </div>

      {notice && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{notice}</p>
      )}

      <section className="mt-8 space-y-3">
        {visibleEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            暂无留言
          </div>
        ) : (
          visibleEntries.map((e) => {
            const isOpen = replyMap[e.id]?.expanded;
            return (
              <div key={e.id} className="space-y-3">
                <EntryCard
                  entry={e}
                  onReact={react}
                  onDelete={del}
                  onOpen={() => toggleReplies(e.id)}
                  openLabel={isOpen ? "收起回复" : `展开回复${e.stats.commentCount ? `(${e.stats.commentCount})` : ""}`}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setReplyBoxOpen((prev) => ({ ...prev, [e.id]: !prev[e.id] }))}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                  >
                    {replyBoxOpen[e.id] ? "取消回复" : "回复"}
                  </button>
                </div>
                {replyBoxOpen[e.id] && (
                  <Editor
                    compact
                    placeholder={`回复 ${e.authorName || "用户"}...`}
                    submitLabel="回复"
                    onSubmit={(p) => postComment(e.id, p)}
                  />
                )}
                {renderReplies(e.id, 0)}
              </div>
            );
          })
        )}
      </section>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => loadList(page + 1, true)}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            {loading ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}
        </div>
      </div>
    </main>
  );
}
