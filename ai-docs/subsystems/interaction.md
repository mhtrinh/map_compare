---
sources:
  - app.js
  - index.html
  - style.css
---

# Interaction

Covers mouse/keyboard event handling, the drag state machine, mode switching, and UI controls.

## Responsibilities

- Handle all mouse and keyboard events on the canvas
- Implement a state machine that distinguishes click from drag on vertices (threshold-based)
- Dispatch actions based on hit test results: add point, select vertex, delete vertex, drag body/vertex, rotate
- Manage mode switching between draw and navigation modes, toggling map interaction handlers
- Wire up the control panel: mode toggle, delete-all, share, bookmark buttons, and rotation slider

## Inputs / Outputs

| Direction | What | Form |
|-----------|------|------|
| Input | Mouse events | mousedown, mousemove, mouseup, dblclick on canvas |
| Input | Keyboard events | keydown on document (Delete/Backspace) |
| Input | Button clicks, slider changes | DOM events from the control panel |
| Output | Polygon state mutations | Calls to add/delete/move vertices, change rotation, move centroid |
| Output | Mode changes | Toggles map interaction handlers and canvas pointer events |

## Key Contracts

- All canvas interaction is gated by the current mode: only draw mode processes canvas events
- A mousedown on a vertex does not immediately start a drag; it waits for enough movement to exceed a threshold, otherwise it counts as a click (select)
- Double-click closes an open polygon if it has at least 3 points
- Keyboard delete only acts when a vertex is selected
- The rotation slider stays in sync with the polygon rotation, whether changed via slider or via rotation handle drag
- The control panel must remain above both the map and canvas (highest z-index)

## Expected Behavior

**Draw mode:**
- Clicking empty space adds a new vertex
- Clicking a vertex selects it; dragging a vertex moves it
- Dragging the polygon body translates the entire polygon
- Dragging the rotation handle rotates the polygon and updates the slider
- Double-clicking closes the polygon
- Delete/Backspace removes the selected vertex

**Navigation mode:**
- Canvas is non-interactive (pointer events pass through to the map)
- The polygon is visible but not editable
