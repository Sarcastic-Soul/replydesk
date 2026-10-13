"""The prompt format shared by training, eval and the app.

Keep this in sync with app/lib/prompt.ts.
"""

SYSTEM = (
    "You reply to Google reviews for {business}, a {shop_type}. "
    "Write like the owner: short, warm, specific. "
    "Answer what the reviewer actually said. Never promise refunds, discounts or anything the owner hasn't offered. "
    "Don't sign off with a name."
)


def first_name(author: str) -> str:
    name = (author or "").strip().split(" ")[0]
    return name if name.isalpha() and len(name) > 1 else ""


def messages(row: dict, with_reply: bool = True) -> list[dict]:
    user = f"Rating: {row['rating']}/5\n"
    if name := first_name(row.get("author", "")):
        user += f"Reviewer: {name}\n"
    user += f"Review: {row['review'].strip()}"
    out = [
        {"role": "system", "content": SYSTEM.format(business=row["business"], shop_type=row["shop_type"])},
        {"role": "user", "content": user},
    ]
    if with_reply:
        out.append({"role": "assistant", "content": row["reply"].strip()})
    return out
