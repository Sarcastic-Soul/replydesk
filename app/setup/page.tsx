import type { Metadata } from "next";
import { SetupForm } from "@/components/setup-form";
import { getShop } from "@/lib/data";

export const metadata: Metadata = { title: "Shop setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const shop = await getShop();
  return (
    <div className="page">
      <h1>Shop setup</h1>
      <p className="lede">Two minutes. This is what ReplyDesk knows about you when it writes a reply.</p>
      <SetupForm shop={shop} />
    </div>
  );
}
