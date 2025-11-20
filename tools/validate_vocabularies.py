#!/usr/bin/env python3
"""Validate the verbs + rels sections embedded inside seed-taxonomies.json."""

import argparse
import json
import sys
from pathlib import Path


def load_seed(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def main(seed_path: Path):
    doc = load_seed(seed_path)
    verbs = doc.get("verbs", []) or []
    rels = doc.get("rels", {}) or {}

    # Prepare core verb sets
    core_ids = set()
    for v in verbs:
        vid = v.get("id")
        if vid:
            core_ids.add(vid)

    rel_ids = set(rels.keys())

    issues = {
        "missing_lex_ref_in_core": [],
        "invalid_inverse_targets": [],
        "empty_or_missing_fields": [],
    }

    # Validate each rel
    for rid, rel in rels.items():
        for field in ("id", "description"):
            if not rel.get(field):
                issues["empty_or_missing_fields"].append({"rel": rid, "missing_field": field})

        lex_ref = rel.get("lex_ref")
        if lex_ref and lex_ref not in core_ids:
            issues["missing_lex_ref_in_core"].append({"rel": rid, "lex_ref": lex_ref})

        inv = rel.get("inverse_of")
        if inv:
            if isinstance(inv, list):
                for target in inv:
                    if target not in rel_ids:
                        issues["invalid_inverse_targets"].append({"rel": rid, "target": target})
            elif isinstance(inv, str):
                if inv.lower() != "null" and inv not in rel_ids:
                    issues["invalid_inverse_targets"].append({"rel": rid, "target": inv})

    summary = {k: len(v) for k, v in issues.items()}
    clean = all(count == 0 for count in summary.values())
    result = {
        "seed_file": str(seed_path),
        "summary": summary,
        "issues": issues,
        "status": "OK" if clean else "ISSUES_FOUND",
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if clean else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate verbs + rels inside seed-taxonomies.json")
    parser.add_argument(
        "--seed",
        default=Path(__file__).resolve().parents[1] / "data" / "seed-taxonomies.json",
        type=Path,
        help="Path to seed-taxonomies.json",
    )
    args = parser.parse_args()
    sys.exit(main(args.seed))
