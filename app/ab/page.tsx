import type { Metadata } from "next";
import { AbTest } from "@/components/ab-test";
import { shuffleSides } from "@/lib/ab";
import { getAbPairs } from "@/lib/data";

export const metadata: Metadata = { title: "Blind test" };
export const dynamic = "force-dynamic";

export default async function AbPage() {
  const { pairs, isSample } = await getAbPairs();
  const blind = shuffleSides(pairs);
  return (
    <div className="page">
      <h1>Blind test</h1>
      <p className="lede">
        Two replies to the same review. You are not told which one came from which model. Pick the one you would rather send.
      </p>
      {isSample && (
        <p className="note-sample">These are hand-written sample pairs for now. Pairs from the real eval run replace them.</p>
      )}
      <AbTest pairs={blind} />
    </div>
  );
}
