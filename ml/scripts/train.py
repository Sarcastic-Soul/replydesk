"""LoRA fine-tune Qwen3.5-4B on Tinker with thinking turned off.

    uv run python scripts/train.py v2         # full run, logs to runs/v2
    uv run python scripts/train.py smoke      # 3 steps to check the setup

v1 (2 epochs on unfiltered replies) learned to argue with unhappy reviewers.
v2 trains on the filtered set for 1 epoch; held-out loss stopped improving
after about 75 steps in v1 anyway.
"""

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from tinker_cookbook import hyperparam_utils
from tinker_cookbook.renderers import TrainOnWhat
from tinker_cookbook.supervised import train
from tinker_cookbook.supervised.data import FromConversationFileBuilder
from tinker_cookbook.supervised.types import ChatDatasetBuilderCommonConfig

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT.parent.parent / ".env")

MODEL = "Qwen/Qwen3.5-4B"
RENDERER = "qwen3_5_disable_thinking"


def config(name: str) -> train.Config:
    smoke = name == "smoke"
    common = ChatDatasetBuilderCommonConfig(
        model_name_for_tokenizer=MODEL,
        renderer_name=RENDERER,
        max_length=2048,
        batch_size=64,
        train_on_what=TrainOnWhat.LAST_ASSISTANT_MESSAGE,
    )
    data = FromConversationFileBuilder(
        common_config=common, file_path=str(ROOT / "data" / os.environ.get("TRAIN_FILE", "train_chat.jsonl")), test_size=200, shuffle_seed=26
    )
    return train.Config(
        log_path=str(ROOT / "runs" / name),
        model_name=MODEL,
        recipe_name="replydesk",
        renderer_name=RENDERER,
        dataset_builder=data,
        learning_rate=hyperparam_utils.get_lr(MODEL),
        lr_schedule="linear",
        num_epochs=int(os.environ.get("EPOCHS", 1)),
        lora_rank=32,
        save_every=3 if smoke else int(os.environ.get("SAVE_EVERY", 25)),
        eval_every=3 if smoke else int(os.environ.get("SAVE_EVERY", 25)),
        max_steps=3 if smoke else None,
    )


if __name__ == "__main__":
    asyncio.run(train.main(config(sys.argv[1] if len(sys.argv) > 1 else "v3")))
