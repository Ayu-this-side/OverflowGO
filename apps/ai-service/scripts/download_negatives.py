#!/usr/bin/env python3
"""Download openly licensed negative photos for threshold calibration.

Calibration needs images where nothing is overflowing: clean bins, clean
ground, and scenes without bins. Positives are the owner-provided photos in
``Model/Dataset/Garbage``.

Source: Wikimedia Commons. We keep only CC0 / public-domain / CC BY / CC BY-SA
files and write a LICENSES.md next to them.

Usage:
    python scripts/download_negatives.py --per-category 8
"""

from __future__ import annotations

import argparse
import html
import io
import re
import time
from pathlib import Path

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = ROOT / "Model" / "Dataset" / "Negatives"
API_URL = "https://commons.wikimedia.org/w/api.php"
HEADERS = {
    "User-Agent": (
        "OverflowGo/0.1 (local model calibration; "
        "https://github.com/Ayu-this-side/OverflowGO)"
    ),
}
MAX_EDGE = 1280
CATEGORY_QUERIES = {
    "clean-bins": [
        "empty wheelie bin",
        "recycling container",
        "waste container",
    ],
    "clean-ground": [
        "empty pedestrian street",
        "clean park lawn",
        "empty paved road",
    ],
    "non-bin": [
        "office desk",
        "tree in park",
        "building facade",
    ],
}
ALLOWED_LICENSE_TAGS = (
    "cc0",
    "public domain",
    "cc by",
    "cc-by",
    "attribution",
    "pd",
)


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", "", value)
    return html.unescape(text).strip()


def search(query: str, limit: int) -> list[dict]:
    response = requests.get(
        API_URL,
        params={
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}",
            "gsrnamespace": "6",
            "gsrlimit": limit,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|size",
            "iiurlwidth": MAX_EDGE,
            "format": "json",
            "formatversion": "2",
        },
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    pages = response.json().get("query", {}).get("pages", [])
    return pages


def pick_image(page: dict) -> tuple[str, dict] | None:
    info = (page.get("imageinfo") or [{}])[0]
    metadata = info.get("extmetadata") or {}
    license_name = strip_html(metadata.get("LicenseShortName", {}).get("value"))
    lowered = license_name.lower()
    if not any(tag in lowered for tag in ALLOWED_LICENSE_TAGS):
        return None
    if "non-free" in lowered or "fair use" in lowered:
        return None
    url = info.get("thumburl") or info.get("url")
    if not url:
        return None
    return url, {
        "license": license_name,
        "license_url": strip_html(metadata.get("LicenseUrl", {}).get("value")),
        "artist": strip_html(metadata.get("Artist", {}).get("value")),
        "description_url": info.get("descriptionurl"),
        "page_id": page.get("pageid"),
    }


def download(url: str, destination: Path) -> bool:
    try:
        response = requests.get(url, headers=HEADERS, timeout=45)
        response.raise_for_status()
        image = Image.open(io.BytesIO(response.content))
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((MAX_EDGE, MAX_EDGE))
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=88)
        return True
    except (requests.RequestException, OSError, ValueError) as error:
        print(f"  skip: {error}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--per-category", type=int, default=8)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    seen: set[int] = set()
    credits: list[dict] = []

    for category, queries in CATEGORY_QUERIES.items():
        print(f"[{category}] target {args.per_category} images")
        saved = 0
        for query in queries:
            if saved >= args.per_category:
                break
            try:
                print(f"  searching: {query}")
                pages = search(query, max(args.per_category * 2, 6))
            except (requests.RequestException, ValueError) as error:
                print(f"  search failed: {error}")
                continue

            for page in pages:
                if saved >= args.per_category:
                    break
                page_id = page.get("pageid")
                if not page_id or page_id in seen:
                    continue
                seen.add(page_id)
                picked = pick_image(page)
                if not picked:
                    continue
                url, credit = picked
                title = page.get("title", "").removeprefix("File:")
                destination = args.out / category / f"{category}-{saved + 1:03d}.jpg"
                print(f"    -> {title[:80]}")
                if download(url, destination):
                    saved += 1
                    credits.append(
                        {
                            "file": str(destination.relative_to(args.out)).replace("\\", "/"),
                            "title": title,
                            **credit,
                        }
                    )
                time.sleep(0.4)
            time.sleep(0.8)
        print(f"[{category}] saved {saved}")

    lines = [
        "# Negative photo credits",
        "",
        "Downloaded from [Wikimedia Commons](https://commons.wikimedia.org) for threshold calibration.",
        "Each image keeps its original license; see the table below.",
        "",
        "| File | Title | Creator | License | Source |",
        "|------|-------|---------|---------|--------|",
    ]
    for credit in credits:
        source = credit.get("description_url") or ""
        lines.append(
            "| {file} | {title} | {creator} | {license} | {source} |".format(
                file=credit["file"],
                title=(credit["title"] or "").replace("|", "/"),
                creator=(credit["artist"] or "").replace("|", "/"),
                license=(credit["license"] or "").replace("|", "/"),
                source=source.replace("|", "/"),
            )
        )
    (args.out / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    total = sum(1 for _ in args.out.rglob("*.jpg"))
    print(f"Done. {total} images in {args.out}")
    if total == 0:
        print("No images downloaded. Add negatives manually and re-run calibration.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
