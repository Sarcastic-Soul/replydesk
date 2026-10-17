// Puts the demo shop and its sample reviews into Postgres. Safe to run again.
// Run: bun --env-file=.env.local scripts/seed.ts
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { ssl: "require", max: 1 });

const H = 3600_000;
// Real reviews from the public Google Local Reviews dataset (other businesses), shortened to first name and initial.
const REVIEWS: { author: string; rating: number; text: string; age: number; reply?: string }[] = [
  { author: "Derrick R.", rating: 1, text: "A 45+ minute wait on only 3 sandwiches! Also 2 of the sandwiches were supposed to be grilled to perfection and not one of them were grilled or hot! Wasted so much time!", age: 2 * H },
  { author: "Vanessa R.", rating: 1, text: "My husband was in line for 30 minutes and they didn't take his order even the people that went in after him got their stuff made. Favoritism I say.", age: 26 * H },
  { author: "Pamela D.", rating: 2, text: "The lady behind the counter was very rude. First and last visit.", age: 30 * H },
  { author: "Justin H.", rating: 4, text: "Good pizza, the cheesy bread sticks were also good, friendly staff, overall chill atmosphere, would return in the near future for another bite to eat.", age: 72 * H },
  { author: "Rich B.", rating: 5, text: "Beautiful, small coffee shop with a great staff and excellent coffee and treats. Very comfy setting with vegan options as well.", age: 96 * H },
];
const FACTS = [
  "Open from 12:30 pm to 1 am",
  "Mostly serves college students from the campus next door",
  "Veg and non-veg momos, pizzas, grilled chicken and pastries",
];

let [shop] = await sql`select id from shops order by created_at limit 1`;
if (!shop) {
  [shop] = await sql`insert into shops (name, category, city, owner_name)
    values ('HOP-In Café', 'cafe/restaurant', 'Naya Raipur', 'Pratik') returning id`;
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
