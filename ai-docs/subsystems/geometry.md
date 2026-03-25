---
sources:
  - app.js
---

# Geometry

Covers coordinate math, hit testing, and the polygon data model.

## Responsibilities

- Convert distances between meters and screen pixels, accounting for map zoom and Web Mercator latitude distortion
- Compute screen-pixel positions of all polygon vertices from their meter offsets, applying rotation
- Determine what interactive element (if any) is under a given screen coordinate
- Store and mutate the polygon's geometric state: vertex positions as meter offsets, centroid, rotation, open/closed status

## Inputs / Outputs

| Direction | What | Form |
|-----------|------|------|
| Input | User screen coordinates | (x, y) pixel position |
| Input | Map zoom level and centroid screen position | From map instance and polygon state |
| Output | Screen-pixel vertex positions | Array of {x, y} |
| Output | Hit result | Object with `type` field and optional `index` |
| Output | Updated polygon state | Vertex list, centroid, rotation, closed flag |

## Key Contracts

- Vertex positions are stored as meter offsets from the centroid, not screen or geographic coordinates; this makes the polygon resolution-independent and repositionable
- The first vertex added sets the centroid screen position; its meter offset is zero
- Meter-to-pixel conversion must be consistent in both directions so that dragging a vertex and reading it back produces the same meter offset
- Rotation is applied in the meter-offset domain before converting to pixels
- Hit testing priority order (highest to lowest): rotation handle, delete icons, vertex handles, polygon body, empty — this ensures overlapping elements resolve to the most specific interactive target
- Deleting a vertex that brings the count below 3 forces the polygon open; deleting all vertices resets the entire state

## Expected Behavior

- At higher zoom levels, the same meter distance produces more pixels
- At higher latitudes, the same meter distance produces fewer pixels (Mercator distortion)
- Hit test returns one of: `rotation-handle`, `delete-icon` (with index), `vertex` (with index), `body`, or `empty`
- With no polygon present, hit test always returns empty
