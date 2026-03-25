---
sources:
  - app.js
  - style.css
---

# Rendering

Covers canvas lifecycle and all visual drawing.

## Responsibilities

- Maintain a full-viewport canvas overlay positioned above the map
- Draw the polygon outline, fill, vertex handles, rotation handle, and delete icons
- Clear and redraw from scratch on every state change or viewport update

## Inputs / Outputs

| Direction | What | Form |
|-----------|------|------|
| Input | Polygon pixel positions | Array of {x, y} from coordinate math |
| Input | Interaction state | Hovered vertex index, selected vertex index, current mode |
| Input | Viewport resize events | Window resize callback |
| Output | Visual frame | Pixels rendered to the canvas |

## Key Contracts

- The canvas z-index must be above the map but below the controls panel
- Rendering is stateless: every call clears the canvas and redraws from scratch
- In navigation mode, only the polygon shape is drawn (no handles)
- In draw mode, vertex handles, rotation handle, and delete icons are also drawn
- On window resize, the canvas dimensions update and the centroid position scales proportionally

## Expected Behavior

- Open polygons render as a polyline with dot markers at each vertex
- Closed polygons render as a filled, stroked shape
- The selected vertex is visually distinct; hovering a vertex shows a delete icon
- The rotation handle appears as a colored circle connected to the centroid by a dashed line
