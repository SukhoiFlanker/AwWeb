这是一个基于 Next.js App Router + Supabase Auth 的项目，包含登录/注册、管理员后台、反馈留言板等模块。

## 快速开始

启动开发环境：

```bash
pnpm dev
```

浏览器访问：http://localhost:3000

## Supabase

本项目依赖 Supabase Postgres 表结构，SQL 在 `SUPABASE_SCHEMA.sql`：

- 互动留言板 `/feedback` 使用：
  - `public.guestbook_entries`（留言/评论）
  - `public.guestbook_reactions`（点赞/点踩）
- 公告/反馈栏：
  - `public.feedback_announcements`（公告）
  - `public.feedback_announcement_reactions`（公告 emoji 反馈）
- 注册流程：
  - `public.user_profiles`（用户名）
  - `public.email_verifications`（邮箱验证码）

如果你访问 `/feedback` 时提示表不存在，请先在 Supabase SQL Editor 执行 `SUPABASE_SCHEMA.sql`（包含 Guestbook 段落）。

## 环境变量（.env.local）

必需：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`

可选：

- `ADMIN_CONTACT`（管理员联系方式展示）

## 权限与入口

- 管理员判断只在服务端完成（`/api/me`）。
- 管理后台入口：`/admin/posts`
- 反馈留言板：`/feedback`
- 我的账号：`/me`

## 近期变更（准备进入 Chat 阶段）

已完成：

- Cookie 鉴权 `/api/me`
- Admin 后台（用户列表/发言/聊天记录）
- 反馈留言板（评论树、点赞点踩、删除、通知）
- 公告栏（仅管理员发布 + emoji 反馈）

接下来重点：

- Chat 会话与消息的完整体验（加载、分页、权限、审计）

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
