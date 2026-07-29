#!/usr/bin/env python3
"""Update AI_ENDPOINTS.md with 3 new v6.82 endpoints, renumber all rows sequentially."""
import re
from pathlib import Path

ENDPOINTS_FILE = Path("/home/z/my-project/AI_ENDPOINTS.md")

NEW_ENDPOINTS = [
    ("buyer-segmentation-engine", "/api/ai/buyer-segmentation-engine"),
    ("inventory-slow-mover-analyzer", "/api/ai/inventory-slow-mover-analyzer"),
    ("listing-meta-tag-optimizer", "/api/ai/listing-meta-tag-optimizer"),
]

def main():
    content = ENDPOINTS_FILE.read_text(encoding="utf-8")
    lines = content.split("\n")
    new_lines = []
    inserted = {ep[0]: False for ep in NEW_ENDPOINTS}

    row_re = re.compile(r'^\| (\d+) \| ([^|]+?) \| (`[^`]+`) \|$')

    for line in lines:
        m = row_re.match(line)
        if not m:
            new_lines.append(line)
            continue
        current_name = m.group(2).strip()
        for new_name, new_path in NEW_ENDPOINTS:
            if not inserted[new_name] and new_name < current_name:
                new_lines.append(f"__NEW__{new_name}__{new_path}")
                inserted[new_name] = True
        new_lines.append(line)

    for new_name, new_path in NEW_ENDPOINTS:
        if not inserted[new_name]:
            new_lines.append(f"__NEW__{new_name}__{new_path}")

    final_lines = []
    counter = 0
    seen_names = set()
    for line in new_lines:
        if line.startswith("__NEW__"):
            parts = line.split("__")
            name = parts[2]
            path = parts[3]
            if name in seen_names:
                continue  # skip duplicate
            seen_names.add(name)
            counter += 1
            final_lines.append(f"| {counter} | {name} | `{path}` |")
        else:
            m = row_re.match(line)
            if m:
                name = m.group(2).strip()
                if name in seen_names:
                    continue  # skip duplicate
                seen_names.add(name)
                counter += 1
                final_lines.append(f"| {counter} | {name} | {m.group(3)} |")
            else:
                final_lines.append(line)

    ENDPOINTS_FILE.write_text("\n".join(final_lines), encoding="utf-8")
    print(f"Done. Total rows: {counter}")
    print(f"Unique names: {len(seen_names)}")

    for ep_name, _ in NEW_ENDPOINTS:
        if ep_name in ENDPOINTS_FILE.read_text(encoding="utf-8"):
            print(f"  OK {ep_name} inserted")
        else:
            print(f"  MISSING {ep_name}")

if __name__ == "__main__":
    main()
