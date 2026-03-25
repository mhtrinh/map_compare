---
sources:
  - app.js
---

# Persistence

Covers URL serialization, share functionality, and the bookmark system.

## Responsibilities

- Encode the current application state into a URL hash and decode it on page load
- Copy the shareable URL to the clipboard
- Manage a list of named bookmarks (add, rename, delete, navigate)
- Reverse-geocode bookmark locations via Nominatim for automatic naming

## Inputs / Outputs

| Direction | What | Form |
|-----------|------|------|
| Input (serialize) | Map center/zoom, polygon centroid as lat/lng, vertex meter offsets, rotation, closed flag, bookmarks | Application state |
| Output (serialize) | URL hash | Base64-encoded JSON in `window.location.hash` |
| Input (deserialize) | URL hash string | Base64-encoded JSON |
| Output (deserialize) | Restored application state | Map view set, polygon and bookmarks restored |

## Key Contracts

- The serialization format is versioned (currently v1) to allow future schema changes
- The polygon centroid is stored as geographic coordinates (lat/lng), not screen pixels, so share links work at any screen size
- Vertex offsets are stored in meters, preserving real-world dimensions
- If deserialization fails, the app falls back to navigation mode without error
- Bookmarks are included in the serialized state, so shared URLs preserve bookmarks
- Reverse geocoding has a 3-second timeout; on failure, a generic fallback name is used

## Expected Behavior

- Clicking Share encodes the state and copies the URL; if nothing to share, a brief feedback message appears
- Opening a URL with a valid hash restores the exact map view, polygon, and bookmarks
- Bookmarks can be navigated to, renamed inline, and deleted; changes auto-serialize to the URL hash
