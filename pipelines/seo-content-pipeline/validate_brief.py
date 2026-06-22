#!/usr/bin/env python3
"""Validate a BnBuddy SEO research brief against schema and business rules."""
import json, sys, os

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 validate_brief.py <brief.json>")
        sys.exit(1)

    brief_path = sys.argv[1]
    schema_path = os.path.join(os.path.dirname(brief_path) or ".", "research-brief.schema.json")

    # Load brief
    try:
        with open(brief_path) as f:
            brief = json.load(f)
    except json.JSONDecodeError as e:
        print(f"JSON SYNTAX ERROR: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"FILE NOT FOUND: {brief_path}")
        sys.exit(1)

    errors = []

    # Required top-level fields
    required = [
        "generatedAt", "weekOf", "agentVersion", "confidence",
        "existingPages", "existingBlogPosts", "targetCities",
        "blogTopics", "competitorUpdates", "contentPlan", "dataQuality"
    ]
    for field in required:
        if field not in brief:
            errors.append(f"Missing required field: {field}")

    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        sys.exit(1)

    # Confidence requires reason if not high
    if brief["confidence"] != "high" and not brief.get("confidenceReason"):
        errors.append("confidenceReason required when confidence is not 'high'")

    # contentPlan must have exactly 3 items
    if not isinstance(brief["contentPlan"], list) or len(brief["contentPlan"]) != 3:
        errors.append("contentPlan must have exactly 3 items")
    else:
        runs = sorted([item["run"] for item in brief["contentPlan"]])
        if runs != [1, 2, 3]:
            errors.append(f"contentPlan run numbers must be [1, 2, 3], got {runs}")

        # Check refs are valid
        city_slugs = {c["slug"] for c in brief.get("targetCities", [])}
        blog_slugs = {b["slug"] for b in brief.get("blogTopics", [])}
        existing_pages = set(brief.get("existingPages", []))
        existing_blogs = set(brief.get("existingBlogPosts", []))

        blog_count = 0
        for item in brief["contentPlan"]:
            ref = item.get("ref", "")
            item_type = item.get("type", "")
            if item_type == "geo-page":
                if ref not in city_slugs:
                    errors.append(f"contentPlan ref '{ref}' not found in targetCities")
                if ref in existing_pages:
                    errors.append(f"contentPlan ref '{ref}' already in existingPages")
            elif item_type == "blog-post":
                blog_count += 1
                if ref not in blog_slugs:
                    errors.append(f"contentPlan ref '{ref}' not found in blogTopics")
                if ref in existing_blogs:
                    errors.append(f"contentPlan ref '{ref}' already in existingBlogPosts")

        # Max 1 blog post unless no urgent geo pages
        urgent_cities = [c for c in brief.get("targetCities", []) if c.get("urgent")]
        if blog_count > 1 and urgent_cities:
            errors.append("Max 1 blog post per week when urgent geo pages exist")

        # Urgent city must be run 1
        if urgent_cities:
            run1 = next((i for i in brief["contentPlan"] if i["run"] == 1), None)
            if run1:
                urgent_slugs = {c["slug"] for c in urgent_cities}
                if run1["type"] != "geo-page" or run1["ref"] not in urgent_slugs:
                    errors.append("Urgent city must be assigned run: 1")

    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        sys.exit(1)

    print("VALIDATION PASSED ✓")
    sys.exit(0)

if __name__ == "__main__":
    main()
