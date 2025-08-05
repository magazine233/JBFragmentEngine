import os
import requests
import json

TYPESENSE_HOST = "http://localhost:8108"
API_KEY = "xyz123abc"  # ← Replace with your actual key
COLLECTION_NAME = "content_fragments"
OUTPUT_FILE = "fragments/fragments_dump.json"

def export_all_documents():
    headers = {
        "X-TYPESENSE-API-KEY": API_KEY
    }

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    url = f"{TYPESENSE_HOST}/collections/{COLLECTION_NAME}/documents/export"
    print(f"Requesting: {url}")
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        jsonl = response.text.strip().splitlines()
        docs = [json.loads(line) for line in jsonl]

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(docs, f, indent=2, ensure_ascii=False)

        print(f"Exported {len(docs)} documents to {OUTPUT_FILE}")
    else:
        print(f"Error {response.status_code}: {response.text}")

if __name__ == "__main__":
    export_all_documents()
