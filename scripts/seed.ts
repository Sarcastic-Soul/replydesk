// Puts the demo shop and its sample reviews into Postgres. Safe to run again.
// Run: bun --env-file=.env.local scripts/seed.ts
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { ssl: "require", max: 1 });

const H = 3600_000;
const REVIEWS = [
  { author: "Rohan M.", rating: 2, text: "Car was ready a day late and nobody called to tell me. Work itself was fine, brakes feel good now, but I had to take leave twice.", age: 2 * H },
  { author: "Ankit P.", rating: 1, text: "Charged ₹800 for a check that took five minutes.", age: 26 * H },
  { author: "Meera K.", rating: 4, text: "Good service, the waiting area could be cleaner.", age: 28 * H },
  { author: "Priya S.", rating: 5, text: "Ramesh bhai fixed the AC in under an hour. Honest price, showed me the old part.", age: 72 * H, reply: "Thank you Priya, I'll tell Ramesh. See you next time. — Ganesh" },
  { author: "David L.", rating: 5, text: "Got me back on the road on a Sunday. Lifesavers.", age: 96 * H, reply: "Glad we could help, David. Drive safe. — Ganesh" },
];
const FACTS = [
  "Same-day WhatsApp update when a job is delayed",
  "Ask for Ramesh at the front desk",
  "Free re-check within 7 days",
];

let [shop] = await sql`select id from shops order by created_at limit 1`;
if (!shop) {
  [shop] = await sql`insert into shops (name, category, city, owner_name)
    values ('Shree Ganesh Auto Garage', 'auto repair', 'Kothrud, Pune', 'Ganesh') returning id`;
  await sql`insert into shop_facts ${sql(FACTS.map((text, position) => ({ shop_id: shop.id, text, position })))}`;
  console.log("created demo shop");
} else {
  console.log("a shop already exists, leaving it as is");
}

let added = 0;
for (const r of REVIEWS) {
  const [have] = await sql`select id from reviews where shop_id = ${shop.id} and author = ${r.author} and text = ${r.text}`;
  if (have) continue;
  const [rev] = await sql`insert into reviews (shop_id, author, rating, text, source, created_at, status)
    values (${shop.id}, ${r.author}, ${r.rating}, ${r.text}, 'sample', ${new Date(Date.now() - r.age)}, ${r.reply ? "replied" : "needs_reply"})
    returning id`;
  if (r.reply) {
    await sql`insert into replies (review_id, text, sent_at) values (${rev.id}, ${r.reply}, ${new Date(Date.now() - r.age + H)})`;
  }
  added++;
}
console.log(`added ${added} sample reviews`);
await sql.end();
