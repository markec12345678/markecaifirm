#!/usr/bin/env python3
"""
v6.93: Unified AI_ENDPOINTS.md updater.

Replaces the 14 nearly-identical scripts (update_ai_endpoints_v679.py ... v692.py)
with one parameterized script.

USAGE:
    # Add 3 new endpoints (alphabetical insertion)
    python3 scripts/update_ai_endpoints.py \\
        --endpoints buyer-payment-reliability inventory-shrinkage-detector listing-question-optimizer

    # Or read endpoints from a file (one per line)
    python3 scripts/update_ai_endpoints.py --file new-endpoints.txt

    # Dry run (preview changes without writing)
    python3 scripts/update_ai_endpoints.py --dry-run --endpoints foo bar baz

    # Custom path (default: AI_ENDPOINTS.md in repo root, found automatically)
    python3 scripts/update_ai_endpoints.py --path /path/to/AI_ENDPOINTS.md --endpoints foo

BEHAVIOR:
    - Reads AI_ENDPOINTS.md (auto-detects repo root via this file's location)
    - Inserts new endpoint rows in alphabetical order
    - Renumbers all rows sequentially (1, 2, 3, ...)
    - Updates the "Total: N endpoints" header
    - Validates that endpoint names are non-empty and unique
    - Idempotent: running twice with same args is safe
"""
import argparse
import re
import sys
from pathlib import Path


def find_endpoints_file():
    """Find AI_ENDPOINTS.md — in repo root (parent of scripts/ dir)."""
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent
    candidates = [
        repo_root / "AI_ENDPOINTS.md",
        Path.cwd() / "AI_ENDPOINTS.md",
        Path("/home/z/my-project/AI_ENDPOINTS.md"),
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(f"AI_ENDPOINTS.md not found in: {[str(c) for c in candidates]}")


def parse_existing_rows(content):
    """
    Parse the markdown table. Returns (rows, lines).

    rows: list of (number, name, path) tuples (in file order).
    lines: all lines of the file.
    """
    lines = content.split("\n")
    rows = []
    row_re = re.compile(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(`[^`]+`)\s*\|$")
    for line in lines:
        m = row_re.match(line)
        if m:
            num = int(m.group(1))
            name = m.group(2).strip()
            path = m.group(3)
            rows.append((num, name, path))
    return rows, lines


def insert_endpoints_alphabetically(existing_rows, new_endpoints):
    """
    Build the final sorted list of (name, path) tuples, inserting new endpoints
    alphabetically among existing ones.

    Returns list of (name, path) in final order (not yet renumbered).
    """
    existing_names_paths = [(name, path) for _, name, path in existing_rows]
    existing_names = {name for name, _ in existing_names_paths}

    new_tuples = []
    for ep in new_endpoints:
        ep = ep.strip()
        if not ep:
            continue
        if ep in existing_names:
            print(f"  WARN: '{ep}' already exists — skip", file=sys.stderr)
            continue
        path = f"`/api/ai/{ep}`"
        new_tuples.append((ep, path))

    if not new_tuples:
        return existing_names_paths

    combined = existing_names_paths + new_tuples
    combined.sort(key=lambda x: x[0].lower())
    return combined


def renumber_rows(sorted_rows):
    """Generate markdown rows with sequential numbers."""
    lines = []
    for i, (name, path) in enumerate(sorted_rows, start=1):
        lines.append(f"| {i} | {name} | {path} |")
    return lines


def update_total_count(lines, new_count):
    """Update the 'Total: N endpoints' header line."""
    out = []
    for line in lines:
        if re.match(r"^\*\*Total:\s*\d+\s*endpoints\*\*", line):
            line = re.sub(r"\d+", str(new_count), line, count=1)
        out.append(line)
    return out


def main():
    parser = argparse.ArgumentParser(description="Update AI_ENDPOINTS.md with new endpoints.")
    parser.add_argument("--endpoints", nargs="*", default=[],
                        help="Endpoint names to add (alphabetical insertion).")
    parser.add_argument("--file", type=str, help="Read endpoint names from file (one per line)")
    parser.add_argument("--path", type=str, help="Path to AI_ENDPOINTS.md (auto-detect if omitted)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    endpoints = list(args.endpoints)
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"ERROR: File not found: {file_path}", file=sys.stderr)
            sys.exit(1)
        for line in file_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                endpoints.append(line)

    if not endpoints:
        print("ERROR: No endpoints to add. Use --endpoints or --file.", file=sys.stderr)
        sys.exit(1)

    try:
        ep_file = Path(args.path) if args.path else find_endpoints_file()
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if not ep_file.exists():
        print(f"ERROR: AI_ENDPOINTS.md not found: {ep_file}", file=sys.stderr)
        sys.exit(1)

    print(f"File: {ep_file}")
    print(f"Adding {len(endpoints)} endpoint(s): {endpoints}")
    if args.dry_run:
        print("DRY RUN — will not write.")

    content = ep_file.read_text(encoding="utf-8")
    existing_rows, lines = parse_existing_rows(content)
    print(f"Existing rows: {len(existing_rows)}")

    sorted_rows = insert_endpoints_alphabetically(existing_rows, endpoints)
    print(f"After insert: {len(sorted_rows)}")

    new_row_lines = renumber_rows(sorted_rows)

    row_re = re.compile(r"^\|\s*\d+\s*\|\s*[^|]+\s*\|\s*`[^`]+`\s*\|$")
    row_indices = [i for i, line in enumerate(lines) if row_re.match(line)]
    if not row_indices:
        print("ERROR: No existing rows found in file.", file=sys.stderr)
        sys.exit(1)

    start_idx = row_indices[0]
    end_idx = row_indices[-1] + 1
    new_lines = lines[:start_idx] + new_row_lines + lines[end_idx:]

    new_lines = update_total_count(new_lines, len(sorted_rows))

    new_content = "\n".join(new_lines)
    if args.dry_run:
        print("\n--- PREVIEW (first 30 row lines) ---")
        for line in new_row_lines[:30]:
            print(line)
        if len(new_row_lines) > 30:
            print(f"... in {len(new_row_lines) - 30} more lines")
    else:
        ep_file.write_text(new_content, encoding="utf-8")
        print(f"OK Updated: {ep_file}")
        print(f"   Old: {len(existing_rows)} rows")
        print(f"   New: {len(sorted_rows)} rows")


if __name__ == "__main__":
    main()
