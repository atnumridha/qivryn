#!/usr/bin/env python3

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def load_rgb(path: str) -> Image.Image:
    return Image.open(path).convert("RGB")


def active_mask(size: tuple[int, int], mask_path: str | None) -> Image.Image:
    if not mask_path or not Path(mask_path).exists():
        return Image.new("1", size, 1)
    dynamic = Image.open(mask_path).convert("L").point(
        lambda value: 0 if value > 0 else 1
    )
    if dynamic.size != size:
        raise ValueError("Dynamic mask dimensions do not match the golden image")
    return dynamic.convert("1")


def edge_mask(image: Image.Image, enabled: Image.Image) -> Image.Image:
    grayscale = image.convert("L")
    edges = grayscale.filter(ImageFilter.FIND_EDGES).point(
        lambda value: 255 if value >= 48 else 0
    )
    return ImageChops.multiply(edges, enabled.convert("L"))


def compare(
    golden_path: str,
    actual_path: str,
    mask_path: str | None,
    structural_delta: int,
) -> dict:
    golden = load_rgb(golden_path)
    actual = load_rgb(actual_path)
    if golden.size != actual.size:
        return {
            "passed": False,
            "reason": "dimension-mismatch",
            "goldenSize": golden.size,
            "actualSize": actual.size,
        }

    enabled = active_mask(golden.size, mask_path)
    difference = ImageChops.difference(golden, actual).convert("L")
    changed = difference.point(lambda value: 255 if value > 8 else 0)
    changed = ImageChops.multiply(changed, enabled.convert("L"))
    enabled_pixels = sum(1 for value in enabled.getdata() if value)
    changed_pixels = sum(1 for value in changed.getdata() if value)
    pixel_ratio = changed_pixels / max(enabled_pixels, 1)

    golden_edges = edge_mask(golden, enabled)
    actual_edges = edge_mask(actual, enabled)
    dilation_size = structural_delta * 2 + 1
    golden_near = golden_edges.filter(ImageFilter.MaxFilter(dilation_size))
    actual_near = actual_edges.filter(ImageFilter.MaxFilter(dilation_size))
    unmatched_golden = ImageChops.subtract(golden_edges, actual_near).getbbox()
    unmatched_actual = ImageChops.subtract(actual_edges, golden_near).getbbox()

    return {
        "passed": not unmatched_golden and not unmatched_actual,
        "pixelDifferenceRatio": pixel_ratio,
        "structuralDeltaPixels": structural_delta,
        "unmatchedGoldenBounds": unmatched_golden,
        "unmatchedActualBounds": unmatched_actual,
    }


if __name__ == "__main__":
    if len(sys.argv) not in (5, 6):
        raise SystemExit(
            "usage: compare-visuals.py GOLDEN ACTUAL STRUCTURAL_DELTA MAX_PIXEL_RATIO [MASK]"
        )
    golden_path, actual_path = sys.argv[1], sys.argv[2]
    structural_delta = int(sys.argv[3])
    maximum_ratio = float(sys.argv[4])
    mask_path = sys.argv[5] if len(sys.argv) == 6 else None
    result = compare(golden_path, actual_path, mask_path, structural_delta)
    result["passed"] = (
        result["passed"]
        and result.get("pixelDifferenceRatio", 1) <= maximum_ratio
    )
    print(json.dumps(result))
    raise SystemExit(0 if result["passed"] else 1)
