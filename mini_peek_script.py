import json

with open("fragments/export.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print(type(data))

# If it's a dict, print its top-level keys
if isinstance(data, dict):
    print("Top-level keys:", list(data.keys()))

# If it's a string, preview the first 300 characters
elif isinstance(data, str):
    print("Starts with:", data[:300])
