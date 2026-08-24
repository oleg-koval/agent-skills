#!/usr/bin/env python3
"""Summarize Google Search Console Coverage CSV exports."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


STANDARD_FILES = {
    "chart": "Chart.csv",
    "metadata": "Metadata.csv",
    "critical": "Critical issues.csv",
    "non_critical": "Non-critical issues.csv",
}


def read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return [
            {key: (value or "").strip() for key, value in row.items()}
            for row in csv.DictReader(handle)
        ]


def int_or_none(value: str) -> int | None:
    if value == "":
        return None
    try:
        return int(value.replace(",", ""))
    except ValueError:
        return None


def chart_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    points = []
    for row in rows:
        points.append(
            {
                "date": row.get("Date", ""),
                "not_indexed": int_or_none(row.get("Not indexed", "")),
                "indexed": int_or_none(row.get("Indexed", "")),
                "impressions": int_or_none(row.get("Impressions", "")),
            }
        )

    indexed_points = [
        point for point in points if point["indexed"] is not None or point["not_indexed"] is not None
    ]
    first = indexed_points[0] if indexed_points else None
    last = indexed_points[-1] if indexed_points else None

    return {
        "date_range": [points[0]["date"], points[-1]["date"]] if points else None,
        "first_indexing_point": first,
        "latest_indexing_point": last,
        "indexed_delta": None if not first or not last else (last["indexed"] or 0) - (first["indexed"] or 0),
        "not_indexed_delta": None
        if not first or not last
        else (last["not_indexed"] or 0) - (first["not_indexed"] or 0),
        "impressions_total": sum(point["impressions"] or 0 for point in points),
    }


def issue_summary(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    issues = []
    for row in rows:
        reason = row.get("Reason", "")
        if not reason:
            continue
        issues.append(
            {
                "reason": reason,
                "source": row.get("Source", ""),
                "validation": row.get("Validation", ""),
                "pages": int_or_none(row.get("Pages", "")) or 0,
            }
        )
    return sorted(issues, key=lambda issue: issue["pages"], reverse=True)


def load_export(export_dir: Path) -> dict[str, Any]:
    files = {key: export_dir / filename for key, filename in STANDARD_FILES.items()}
    metadata_rows = read_rows(files["metadata"])
    return {
        "export_dir": str(export_dir),
        "metadata": {row.get("Property", ""): row.get("Value", "") for row in metadata_rows},
        "chart": chart_summary(read_rows(files["chart"])),
        "critical_issues": issue_summary(read_rows(files["critical"])),
        "non_critical_issues": issue_summary(read_rows(files["non_critical"])),
        "missing_files": [filename for filename in STANDARD_FILES.values() if not (export_dir / filename).exists()],
    }


def print_markdown(summary: dict[str, Any]) -> None:
    chart = summary["chart"]
    latest = chart["latest_indexing_point"] or {}
    print("# Search Console Coverage Summary")
    print()
    print(f"- Export: `{summary['export_dir']}`")
    if chart["date_range"]:
        print(f"- Date range: {chart['date_range'][0]} to {chart['date_range'][1]}")
    print(f"- Latest indexed: {latest.get('indexed', 'n/a')}")
    print(f"- Latest not indexed: {latest.get('not_indexed', 'n/a')}")
    print(f"- Total impressions in chart: {chart['impressions_total']}")
    if summary["metadata"]:
        print(f"- Metadata: {summary['metadata']}")
    if summary["missing_files"]:
        print(f"- Missing standard files: {', '.join(summary['missing_files'])}")

    for label, issues in (
        ("Critical Issues", summary["critical_issues"]),
        ("Non-Critical Issues", summary["non_critical_issues"]),
    ):
        print()
        print(f"## {label}")
        if not issues:
            print("- None reported")
            continue
        for issue in issues:
            print(
                f"- {issue['reason']}: {issue['pages']} pages"
                f" ({issue['source']}, validation: {issue['validation']})"
            )

    print()
    print("## Notes")
    print("- Standard Coverage exports are aggregate reports; they may not include affected URL examples.")
    print("- Redirect and canonical buckets should be checked against sitemap URLs and live canonical tags.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_dir", type=Path)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    summary = load_export(args.export_dir)
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print_markdown(summary)


if __name__ == "__main__":
    main()
