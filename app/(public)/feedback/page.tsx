"use client";

import { useId } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { guestbookFetch } from "@/lib/guestbook/client";

type GuestbookEntry = {
  id: string;
  createdAt: string;
  parentId: string | null;
  authorName: string | null;
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
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition",
        props.active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
      ].join(" ")}
    >
      <span>{props.label}</span>
      <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
        {props.count}
      </span>
    </button>
  );
}

function Editor(props: {
  initialName?: string;
  placeholder: string;
  submitLabel: string;
  compact?: boolean;
  onSubmit: (p: { authorName?: string; content: string; contentType: "plain" | "md" }) => Promise<void>;
}) {
  const [authorName, setAuthorName] = useState(props.initialName ?? "");
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
      await props.onSubmit({
        authorName: authorName.trim() || undefined,
        content: msg,
        contentType,
      });
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
        <input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="昵称（可选）"
          className="w-48 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:focus:border-zinc-600"
        />
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">格式</label>
          <select
            value={contentType}
            onChange={(e) =>
              setContentType(e.target.value === "plain" ? "plain" : "md")
            }
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
}) {
  const e = props.entry;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">
            {e.authorName || "匿名"}
          </span>
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
          <button
            type="button"
            onClick={() => props.onOpen(e.id)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
          >
            查看/评论
          </button>
        </div>
      </div>

      <div className="mt-3">
        {e.deleted ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">（内容已删除）</p>
        ) : e.contentType === "md" ? (
          <div
            className="text-sm leading-6 text-zinc-900 dark:text-zinc-50"
            dangerouslySetInnerHTML={{ __html: miniMarkdownToHtml(e.content) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-6">{e.content}</pre>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ReactionButton
          active={e.stats.myReaction === 1}
          label="赞"
          count={e.stats.like}
          onClick={() => props.onReact(e.id, e.stats.myReaction === 1 ? 0 : 1)}
        />
        <ReactionButton
          active={e.stats.myReaction === -1}
          label="踩"
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

function CommentTree(props: {
  entry: GuestbookEntry;
  onReact: (entryId: string, value: -1 | 0 | 1) => Promise<void>;
  onDelete: (entryId: string) => Promise<void>;
  onReply: (
    parentId: string,
    p: { authorName?: string; content: string; contentType: "plain" | "md" }
  ) => Promise<void>;
  depth?: number;
}) {
  const maxDepth = 5;
  const depth = props.depth || 0;
  const e = props.entry;

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700" : ""}>
      <EntryCard entry={e} onReact={props.onReact} onDelete={props.onDelete} onOpen={() => {}} />

      {depth < maxDepth && e.children && e.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {e.children.map((child) => (
            <CommentTree
              key={child.id}
              entry={child}
              onReact={props.onReact}
              onDelete={props.onDelete}
              onReply={props.onReply}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {depth < maxDepth && (
        <div className="mt-3">
          <Editor
            compact
            placeholder={`回复 ${e.authorName || "匿名"}...`}
            submitLabel="回复"
            onSubmit={(p) => props.onReply(e.id, p)}
            initialName=""
          />
        </div>
      )}
    </div>
  );
}


export default function FeedbackPage() {
    type ActiveDetail = {
    entry: GuestbookEntry;
  };
  const [counts, setCounts] = useState<{ active: number; deleted: number }>({
    active: 0,
    deleted: 0,
  });
  const [activeDetail, setActiveDetail] = useState<ActiveDetail | null>(null);
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"all" | "mine" | "trash">("all");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  const loadList = useCallback(async () => {
    setNotice(null);
    setLoading(true);
     try {
    const params = new URLSearchParams();

    // ✅ 1) 传 status：回收站 => deleted；其它 => active
    params.set("status", mode === "trash" ? "deleted" : "active");

    // ✅ 2) 请求 counts
    params.set("withCounts", "1");

    if (searchQuery.trim()) {
      params.set("search", searchQuery.trim());
    }

    const res = await guestbookFetch(`/api/guestbook?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `加载失败（${res.status}）`);
    }

    setEntries((data.data ?? []) as GuestbookEntry[]);

    // ✅ 3) 保存 counts（后端方案 A 返回的字段）
    if (data.counts) {
      setCounts({
        active: Number(data.counts.active ?? 0),
        deleted: Number(data.counts.deleted ?? 0),
      });
    }
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

  async function loadDetail(id: string) {
    setActiveId(id);
    setActiveDetail(null);
    try {
      const res = await guestbookFetch(`/api/guestbook/${id}?includeComments=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `加载失败（${res.status}）`);
      }

      // Build comment tree
      const entry = data.entry as GuestbookEntry;
      const flatComments = (data.comments ?? []) as GuestbookEntry[];
      
      // Group comments by parent
      const commentMap = new Map<string, GuestbookEntry[]>();
      for (const comment of flatComments) {
        const parentId = comment.parentId || entry.id;
        if (!commentMap.has(parentId)) {
          commentMap.set(parentId, []);
        }
        commentMap.get(parentId)!.push(comment);
      }

      // Recursively build tree
      function buildTree(item: GuestbookEntry): GuestbookEntry {
        const children = commentMap.get(item.id) || [];
        return {
          ...item,
          children: children.map(buildTree),
        };
      }

      const entryWithChildren = buildTree(entry);

      setActiveDetail({
        entry: entryWithChildren,
      });
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : "加载失败");
      setActiveId(null);
    }
  }

  async function postRoot(p: { authorName?: string; content: string; contentType: "plain" | "md" }) {
  const res = await guestbookFetch("/api/guestbook/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const data = await res.json().catch(() => ({}));
  await guardAuthOrThrow(res, data);
  await loadList();
}

  async function postComment(
  parentId: string,
  p: { authorName?: string; content: string; contentType: "plain" | "md" }
) {
  const res = await guestbookFetch("/api/guestbook/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, parentId }),
  });
  const data = await res.json().catch(() => ({}));
  await guardAuthOrThrow(res, data);

  if (activeId) await loadDetail(activeId);
  await loadList();
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

  await loadList();
  if (activeId) await loadDetail(activeId);
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

  await loadList();
  if (activeId === entryId) {
    setActiveId(null);
    setActiveDetail(null);
  } else if (activeId) {
    await loadDetail(activeId);
  }
}

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const visibleEntries = useMemo(() => {
    if (mode === "trash") return entries.filter((e) => e.deleted);
    const base = entries.filter((e) => !e.deleted);
    if (mode === "all") return base;
    return base.filter((e) => e.mine);
  }, [entries, mode]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">留言板</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            留下评论，分享想法，交流反馈。支持 Markdown 格式，尽情发挥吧（请登录并保持礼貌）！
          </p>
        </div>
        <button
          type="button"
          onClick={loadList}
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

          <button
  type="button"
  onClick={() => setMode("trash")}
  className={[
    "rounded-full px-4 py-1.5 text-sm",
    mode === "trash"
      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-black"
      : "border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
  ].join(" ")}
>
  回收站
  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
    {counts.deleted}
  </span>
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
          onClick={loadList}
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
          visibleEntries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              onReact={react}
              onDelete={del}
              onOpen={(id) => void loadDetail(id)}
            />
          ))
        )}
      </section>

      {activeId && (
        <section className="mt-10 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">留言详情</h2>
            <button
              type="button"
              onClick={() => {
                setActiveId(null);
                setActiveDetail(null);
              }}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              关闭
            </button>
          </div>

          {!activeDetail ? (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">加载中...</p>
          ) : (
            <div className="mt-4 space-y-4">
              <CommentTree
                entry={activeDetail.entry}
                onReact={react}
                onDelete={del}
                onReply={postComment}
                depth={0}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}