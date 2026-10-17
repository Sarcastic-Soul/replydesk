"""Rule checks for a reply, shared by the teacher-data script and the eval.

A reply passes when it is short, answers something the reviewer said, has no
stock phrases, argues with nobody and promises only what the shop facts allow.
Everything here is plain code, so checking a reply costs nothing.
"""

import re

CONTACT = re.compile(r"\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}|@[\w-]+\.\w|https?://|www\.", re.I)
STOP = set(
    """the and for that with this was were are you your our have has had but not very they them their there
    what when where which who will would could should from about just been more most also some than then into
    over only really great good nice place time here back again best always never every very much well get got""".split()
)
WORD = re.compile(r"[a-z]{4,}")

STOCK = re.compile(
    r"valued customer|apologi[sz]e for any inconvenience|sorry for any inconvenience|thank you for taking the time"
    r"|we strive|your feedback is (?:important|valuable)|we value your feedback|don.?t hesitate|rest assured"
    r"|we pride ourselves|reach out to (?:us|our)|please contact us|at your earliest convenience|we take .{0,20}seriously"
    r"|exceed your expectations|top priority|look forward to serving you",
    re.I,
)
DEFENSIVE = re.compile(
    r"wrong (?:business|place|store|shop|location)|not (?:a|our) (?:customer|client)|no record|never (?:came|been|visited)"
    r"|you must (?:be thinking|have)|confused|fake review|\bli(?:e|ar|ed|es)\b|competitor|false (?:review|claim|post|statement|accusation)"
    r"|slander|defamat|attorney|lawyer|police|we did not see you|have no idea who|untrue|not true|how dare|ridiculous"
    r"|sorry you feel|sorry you felt",
    re.I,
)
ARGUING = re.compile(
    r"\byou (?:did not|didn.t|were not|weren.t|never|failed|refused|chose|should have|need to|have to understand)\b"
    r"|\bwhy (?:you|would you)\b|\bhowever\b|\bactually\b|\bin fact\b|\bpolicy\b|as (?:stated|explained|mentioned)"
    r"|\bclearly\b|\bobviously\b|for your information|\bfyi\b",
    re.I,
)
ACKNOWLEDGES = re.compile(
    r"sorry|apolog|hear|understand|frustrat|disappoint|regret|fair|you.re right|not the experience|unacceptable", re.I
)
SIGNOFF = re.compile(r"\n\s*[-–—~]+\s*\w|(?:^|\n)\s*(?:sincerely|best regards|kind regards|regards|cheers),?\s*\n", re.I)

# Words that mean the owner will hand over or do something specific.
PROMISE = re.compile(
    r"refund|discount|(?<![-\w])free(?![-\w])|complimentary|on us\b|on the house|gift card|\d+\s?% off|compensat"
    r"|call you|contact you|reach out to you|make (?:it|this|things) right"
    r"|(?:issue|give|offer|apply|provide)\w*\s+(?:you\s+)?(?:a\s+|the\s+)?(?:store\s+)?credit"
    r"|(?:we(?:.ll| will| can| would)|i(?:.ll| will))\s+(?:gladly\s+|happily\s+)?(?:replace|re-?do)\w*",
    re.I,
)

MIN_WORDS, MAX_WORDS = 15, 55


def overlap(review: str, reply: str) -> int:
    rv = {w for w in WORD.findall(review.lower()) if w not in STOP}
    rp = {w for w in WORD.findall(reply.lower()) if w not in STOP}
    return len(rv & rp)


def unbacked_promises(reply: str, facts: list[str]) -> list[str]:
    """Promise phrases in the reply that no shop fact mentions."""
    allowed = " ".join(facts).lower()
    out = []
    for m in PROMISE.finditer(reply):
        word = m.group(0).lower()
        key = re.sub(r"^(?:we|i).(?:ll|will|can|would)\s+|^(?:gladly|happily)\s+", "", word).split()[-1]
        if key not in allowed and key.rstrip("s") not in allowed:
            out.append(word)
    return out


def check(review: str, rating: int, reply: str, facts: list[str] | None = None) -> dict[str, bool]:
    """Each key is True when the reply is fine on that rule."""
    words = len(reply.split())
    return {
        "length": MIN_WORDS <= words <= MAX_WORDS,
        "detail": overlap(review, reply) >= 2,
        "no_stock": not STOCK.search(reply),
        "no_arguing": not DEFENSIVE.search(reply) and not (rating <= 3 and ARGUING.search(reply)),
        "acknowledges": rating > 3 or bool(ACKNOWLEDGES.search(reply[:200])),
        "no_signoff": not SIGNOFF.search(reply) and not CONTACT.search(reply),
        "no_unbacked_promise": not unbacked_promises(reply, facts or []),
    }


def passes(review: str, rating: int, reply: str, facts: list[str] | None = None) -> bool:
    return all(check(review, rating, reply, facts).values())
