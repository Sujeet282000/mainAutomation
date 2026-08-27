import { redirect } from "next/navigation";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await Promise.resolve(params);
  redirect(`/activity/${id}`);
}
