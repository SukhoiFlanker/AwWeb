import { redirect } from "next/navigation";

export default function AdminLegacyIndexPage() {
  redirect("/admin/posts");
}
