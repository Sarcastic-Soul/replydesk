"""Write train/val JSONL in the chat format tinker-cookbook expects."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from replydesk_ml.prompt import messages  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"

for split in ("train", "val"):
    rows = [json.loads(line) for line in (DATA / f"{split}.jsonl").open()]
    with (DATA / f"{split}_chat.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps({"messages": messages(r)}) + "\n")
    print(f"{split}_chat.jsonl: {len(rows)}")
