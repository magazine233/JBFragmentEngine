import json
import csv
import os

# Input and output paths
INPUT_JSON = "fragments/fragments_dump.json"
OUTPUT_CSV = "fragments/fragment_preview.csv"

# Only extract these fields for legibility
FIELDS = [ "id", "url", "title", "component_type", "content_text",
  "provider", "governance", "states", "reading_level",
  "hierarchy_lvl0", "hierarchy_lvl1", "hierarchy_lvl2", "hierarchy_lvl3",
  "has_form", "has_checklist",
  "search_keywords"]

# Make sure the input file exists
if not os.path.exists(INPUT_JSON):
    raise FileNotFoundError(f"Input file not found: {INPUT_JSON}")

# Load JSON data
with open(INPUT_JSON, "r", encoding="utf-8") as f:
    data = json.load(f)

# Write to CSV
with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=FIELDS)
    writer.writeheader()

    for row in data:
        safe_row = {field: row.get(field, "") for field in FIELDS}
        writer.writerow(safe_row)

print(f"✅ Exported {len(data)} fragments to: {OUTPUT_CSV}")
