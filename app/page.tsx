import { Inbox } from "@/components/inbox";
import { getShop, listReviews } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [shop, reviews] = await Promise.all([getShop(), listReviews()]);
  return (
    <>
      <h1 className="sr-only">Review inbox for {shop.name}</h1>
      <Inbox shop={shop} initialReviews={reviews} />
    </>
  );
}
