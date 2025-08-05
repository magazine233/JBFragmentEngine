import streamlit as st
import json
import pandas as pd
import os

st.set_page_config(page_title="Fragment Viewer", layout="wide")
st.title("🔍 Fragment Viewer")

# Load fragments
FRAGMENTS_PATH = "fragments/fragments_dump.json"

if not os.path.exists(FRAGMENTS_PATH):
    st.error(f"File not found: {FRAGMENTS_PATH}")
    st.stop()

with open(FRAGMENTS_PATH, "r", encoding="utf-8") as f:
    fragments = json.load(f)

# Convert to DataFrame for filtering
records = pd.DataFrame(fragments)

# Sidebar filters
st.sidebar.header("🔎 Filter Fragments")

url_filter = st.sidebar.text_input("URL contains:")
title_filter = st.sidebar.text_input("Title contains:")
component_filter = st.sidebar.multiselect("Component type:", options=sorted(records["component_type"].dropna().unique()))

# Apply filters
filtered = records.copy()

if url_filter:
    filtered = filtered[filtered["url"].str.contains(url_filter, case=False, na=False)]

if title_filter:
    filtered = filtered[filtered["title"].str.contains(title_filter, case=False, na=False)]

if component_filter:
    filtered = filtered[filtered["component_type"].isin(component_filter)]

st.success(f"Showing {len(filtered)} of {len(records)} fragments")

# Display fragments
for i, row in filtered.iterrows():
    with st.expander(f"{row.get('title', '(no title)')} — {row.get('url')}"):
        st.markdown(f"**Component Type:** `{row.get('component_type')}`")
        st.markdown(f"**Hierarchy:** {row.get('page_hierarchy')}\n")

        if row.get("content_text"):
            st.text_area("Content Text", row["content_text"], height=200, disabled=True)

        if row.get("content_html"):
            with st.expander("Raw HTML Content"):
                st.code(row["content_html"], language="html")

        st.markdown("---")
