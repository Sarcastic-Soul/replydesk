"""Turn raw review/reply pairs into clean train / val / test sets.

Filters out template replies, chains, replies with contact details and replies
that don't respond to anything the reviewer said, strips sign-offs (the app
adds the owner's own), balances star ratings and splits by business so no
business appears in two splits.
"""

import json
import re
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SEED = 26

N_TRAIN, N_VAL, N_TEST = 6000, 300, 300
LOW_SHARE = 0.5  # share of 1-3 star reviews in every split

# Map Google's first category to the shop types ReplyDesk is for.
SHOP_TYPES = {
    "auto repair": r"auto repair|mechanic|auto body|brake|transmission|oil change|tire shop|auto glass|car repair|smog|muffler|car wash|towing|auto electrical",
    "salon": r"hair salon|beauty salon|barber|nail salon|day spa|massage|esthetician|waxing|tanning|tattoo",
    "dentist": r"dentist|dental|orthodont|chiropract|optometr|physical therap|veterinar|animal hospital|pet groomer",
    "cafe/restaurant": r"restaurant|cafe|coffee|bakery|pizza|diner|bar & grill|sandwich|brewery|food truck|ice cream|donut|deli|taco|burger|grill|pub$|bistro|barbecue",
    "home services": r"plumber|electrician|hvac|heating|air conditioning|roofing|carpet clean|cleaning service|landscap|pest control|locksmith|handyman|contractor|painter|garage door|appliance repair|moving|storage|flooring|window",
    "retail": r"store$|shop$|boutique|florist|jewelry|pharmacy|hardware|bike|thrift|gift|book|furniture|nursery|liquor|pet supply|sporting goods|music store",
}
EXCLUDE = r"hotel|motel|inn$|resort|lodging|car dealer|bank|credit union|hospital$|insurance|apartment|casino|walmart|gas station|fast food"

CONTACT = re.compile(r"\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}|@[\w-]+\.\w|https?://|www\.", re.I)
SIGNOFF = re.compile(
    r"(\s*(?:[-–—~]+\s*|(?i:thanks|thank you|sincerely|best|cheers|regards|warmly|best regards|kind regards|respectfully),?\s*\n?\s*-?\s*)"
    r"(?:the\s+)?[A-Z][\w.'&]*(?:\s+[A-Z&][\w.'&]*){0,4}"
    r"(?:\s*[,&-]\s*(?i:owner|manager|gm|general manager|team|staff|dds|dmd|and the [\w ]+ team)[\w ]*)?\s*[.!]?\s*)$"
)
STOP = set(
    """the and for that with this was were are you your our have has had but not very they them their there
    what when where which who will would could should from about just been more most also some than then into
    over only really great good nice place time here back again best always never every very much well get got""".split()
)
WORD = re.compile(r"[a-z]{4,}")

# Real owners sometimes argue with reviewers or paste stock text. The model
# should learn neither, so the training set and the retrieval pool drop these.
DEFENSIVE = (
    r"(?i)wrong (?:business|place|store|shop|location)|not (?:a|our) (?:customer|client)|no record|never (?:came|been|visited)"
    r"|you must (?:be thinking|have)|confused|fake review|\bli(?:e|ar|ed|es)\b|competitor|false (?:review|claim|post|statement|accusation)|slander|defamat|i (?:believe|think) this (?:is|to be)|you can.?t get|impossible|not possible"
    r"|attorney|lawyer|police|we did not see you|have no idea who|untrue|not true|how dare|ridiculous|sorry you feel|sorry you felt"
)
ARGUING = (
    r"(?i)\byou (?:did not|didn.t|were not|weren.t|never|failed|refused|chose|should have|need to|have to understand|came in|bought)\b"
    r"|\bwhy (?:you|would you)\b|\bhowever\b|\bactually\b|\bin fact\b|\bpolicy\b|as (?:stated|explained|mentioned)"
    r"|\bclearly\b|\bobviously\b|\bunfortunately you\b|for your information|\bfyi\b"
)
ACKNOWLEDGES = r"(?i)sorry|apolog|thank|appreciate|hear|understand|fair|you.re right|feedback|regret"
STOCK = (
    r"(?i)valued customer|apologi[sz]e for any inconvenience|sorry for any inconvenience|thank you for taking the time|we strive"
    r"|your feedback is (?:important|valuable)|we value your feedback|don.?t hesitate|rest assured|we pride ourselves"
    r"|reach out to (?:us|our)|please contact us|at your earliest convenience|we take .{0,20}seriously|exceed your expectations"
    r"|top priority|look forward to serving you"
)


def good_replies(df: pl.DataFrame) -> pl.DataFrame:
    """Replies worth learning from: not defensive, not stock text, and (v3) long
    enough to say something and answering at least two things the reviewer said.
    v2 without the last rule learned to post short, generic thank-yous."""
    low = pl.col("rating") <= 3
    return df.filter(
        pl.col("reply").str.split(" ").list.len() >= 20,
        pl.col("overlap") >= 2,
        ~pl.col("reply").str.contains(DEFENSIVE),
        ~pl.col("reply").str.contains(STOCK),
        ~low | ~pl.col("reply").str.contains(ARGUING),
        ~low | pl.col("reply").str.slice(0, 200).str.contains(ACKNOWLEDGES),
    )


def shop_type(categories: str) -> str | None:
    first = categories.split("|")[0].lower()
    if not first or re.search(EXCLUDE, first):
        return None
    for name, pat in SHOP_TYPES.items():
        if re.search(pat, first):
            return name
    return None


def strip_signoff(reply: str) -> str:
    out = reply.strip()
    for _ in range(2):
        new = SIGNOFF.sub("", out).strip()
        if new == out or len(new) < 25:
            break
        out = new
    return out


def overlap(review: str, reply: str) -> int:
    rv = {w for w in WORD.findall(review.lower()) if w not in STOP}
    rp = {w for w in WORD.findall(reply.lower()) if w not in STOP}
    return len(rv & rp)


def normalise(reply: str, author: str) -> str:
    s = reply.lower()
    first = (author or "").split(" ")[0].lower()
    if first:
        s = s.replace(first, "")
    return re.sub(r"[^a-z ]", "", s).strip()


def main() -> None:
    df = pl.read_parquet(DATA / "pairs.parquet")
    n0 = df.height

    # English only (mostly ASCII letters), and replies posted within 60 days.
    df = df.filter(
        pl.col("review").str.count_matches(r"[A-Za-z]") / pl.col("review").str.len_chars() > 0.6,
        pl.col("reply").str.count_matches(r"[A-Za-z]") / pl.col("reply").str.len_chars() > 0.6,
        (pl.col("reply_time") - pl.col("review_time")) < 60 * 86400 * 1000,
        ~pl.col("reply").str.contains(CONTACT.pattern),
        ~pl.col("review").str.contains(r"(?i)translated by google"),
    )

    # Small shops only: drop chains (same name at more than 3 locations).
    chain_names = (
        df.group_by("business").agg(pl.col("gmap_id").n_unique().alias("n")).filter(pl.col("n") > 3)["business"]
    )
    df = df.filter(~pl.col("business").is_in(chain_names.implode()))
    df = df.with_columns(pl.col("categories").map_elements(shop_type, return_dtype=pl.String).alias("shop_type"))
    df = df.filter(pl.col("shop_type").is_not_null())

    # Template replies: same normalised reply used more than twice by one business,
    # or an opening line that appears across many businesses.
    df = df.with_columns(
        pl.struct(["reply", "author"]).map_elements(lambda s: normalise(s["reply"], s["author"]), return_dtype=pl.String).alias("norm"),
    ).with_columns(pl.col("norm").str.slice(0, 45).alias("opening"))
    df = df.filter(
        pl.len().over(["gmap_id", "norm"]) <= 2,
        pl.col("gmap_id").n_unique().over("opening") <= 8,
    )

    # Strip sign-offs; the app appends the owner's own name.
    df = df.with_columns(pl.col("reply").map_elements(strip_signoff, return_dtype=pl.String))
    df = df.filter(pl.col("reply").str.len_chars().is_between(40, 600))

    # The reply must respond to something the reviewer said.
    df = df.with_columns(
        pl.struct(["review", "reply"]).map_elements(lambda s: overlap(s["review"], s["reply"]), return_dtype=pl.Int64).alias("overlap")
    ).filter(pl.col("overlap") >= 1)

    # At most 15 pairs per business so a few chatty owners don't dominate the voice.
    df = df.sample(fraction=1.0, shuffle=True, seed=SEED).filter(pl.int_range(pl.len()).over("gmap_id") < 15)
    df = df.with_columns((pl.col("rating") <= 3).alias("low"))
    print(f"{n0} raw pairs -> {df.height} clean ({df['low'].sum()} with 1-3 stars)")
    print(df.group_by("shop_type").len().sort("len", descending=True))

    # Split by business.
    biz = df.select("gmap_id").unique().sort("gmap_id").sample(fraction=1.0, shuffle=True, seed=SEED)["gmap_id"].to_list()
    test_b, val_b = set(biz[:1200]), set(biz[1200:2400])
    splits = {
        "test": df.filter(pl.col("gmap_id").is_in(list(test_b))),
        "val": df.filter(pl.col("gmap_id").is_in(list(val_b))),
        # val/test keep real replies as they are; only train is cleaned.
        "train": good_replies(df.filter(~pl.col("gmap_id").is_in(list(test_b | val_b)))),
    }
    sizes = {"train": N_TRAIN, "val": N_VAL, "test": N_TEST}
    for name, part in splits.items():
        # One pair per business in val/test for variety.
        if name != "train":
            part = part.filter(pl.int_range(pl.len()).over("gmap_id") < 1)
        n_low = int(sizes[name] * LOW_SHARE)
        low = part.filter(pl.col("low")).head(n_low)
        high = part.filter(~pl.col("low")).head(sizes[name] - low.height)
        out = pl.concat([low, high]).sample(fraction=1.0, shuffle=True, seed=SEED)
        cols = ["gmap_id", "business", "shop_type", "categories", "state", "author", "rating", "review", "reply"]
        out.select(cols).write_ndjson(DATA / f"{name}.jsonl")
        print(f"{name}: {out.height} ({out['low'].sum()} low)")

    # Everything left in the train businesses becomes the retrieval pool for Tiger.
    pool = splits["train"].select(["gmap_id", "business", "shop_type", "author", "rating", "review", "reply"])
    pool.write_parquet(DATA / "examples_pool.parquet")
    print(f"examples pool: {pool.height}")
    (DATA / "stats.json").write_text(json.dumps({"raw_pairs": n0, "clean_pairs": df.height}, indent=2))


if __name__ == "__main__":
    main()
