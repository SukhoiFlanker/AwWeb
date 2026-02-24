"use client";

import { useMemo, useState } from "react";

type Reaction = 1 | -1 | 0;

export type ReactionStats = {
  like: number;
  dislike: number;
  myReaction: Reaction;
};

export default function ReactionButtons(props: {
  entryId: string;
  initial: ReactionStats;
  onChange?: (next: ReactionStats) => void; // 可选：让父组件同步更新列表状态
}) {
  const { entryId, initial, onChange } = props;

  const [stats, setStats] = useState<ReactionStats>(initial);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const likeActive = stats.myReaction === 1;
  const dislikeActive = stats.myReaction === -1;

  const classBase =
    "inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm select-none";
  const classActive = "bg-black text-white border-black";
  const classInactive = "bg-white text-gray-800 hover:bg-gray-50";

  function emit(next: ReactionStats) {
    setStats(next);
    onChange?.(next);
  }

  function applyOptimistic(target: 1 | -1): { next: ReactionStats; mode: "set" | "clear" } {
    const cur = stats.myReaction;

    // 再点一次同样按钮：取消
    if (cur === target) {
      const next: ReactionStats = {
        like: stats.like + (target === 1 ? -1 : 0),
        dislike: stats.dislike + (target === -1 ? -1 : 0),
        myReaction: 0,
      };
      return { next, mode: "clear" };
    }

    // 从无/相反切换到 target：互斥切换
    const next: ReactionStats = {
      like: stats.like + (target === 1 ? 1 : cur === 1 ? -1 : 0),
      dislike: stats.dislike + (target === -1 ? 1 : cur === -1 ? -1 : 0),
      myReaction: target,
    };

    return { next, mode: "set" };
  }

  async function send(target: 1 | -1) {
    if (pending) return;
    setErr(null);

    const prev = stats;
    const { next, mode } = applyOptimistic(target);
    emit(next);
    setPending(true);

    try {
      if (mode === "set") {
        const res = await fetch("/api/guestbook/reaction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId, value: target }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
      } else {
        const res = await fetch(`/api/guestbook/reaction?entryId=${encodeURIComponent(entryId)}`, {
          method: "DELETE",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
      }
    } catch (e: unknown) {
      // 回滚
      emit(prev);
      const message = e instanceof Error ? e.message : "操作失败";
      setErr(message);
    } finally {
      setPending(false);
    }
  }

  const likeText = useMemo(() => (likeActive ? "已赞" : "点赞"), [likeActive]);
  const dislikeText = useMemo(() => (dislikeActive ? "已踩" : "点踩"), [dislikeActive]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => send(1)}
        className={[
          classBase,
          likeActive ? classActive : classInactive,
          pending ? "opacity-60" : "",
        ].join(" ")}
        aria-pressed={likeActive}
        title={likeActive ? "再点一次取消点赞" : "点赞"}
      >
        <span>{likeText}</span>
        <span className="tabular-nums">{stats.like}</span>
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => send(-1)}
        className={[
          classBase,
          dislikeActive ? classActive : classInactive,
          pending ? "opacity-60" : "",
        ].join(" ")}
        aria-pressed={dislikeActive}
        title={dislikeActive ? "再点一次取消点踩" : "点踩"}
      >
        <span>{dislikeText}</span>
        <span className="tabular-nums">{stats.dislike}</span>
      </button>

      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
