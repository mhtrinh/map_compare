---
sources:
  - app.js
  - index.html
  - style.css
---

# Interaction

Covers pointer/keyboard event handling, the drag state machine, mode switching, touch support, and UI controls.

## Responsibilities

- Handle all pointer (mouse, touch, pen) and keyboard events on the canvas via the Pointer Events API
- Implement a state machine that distinguishes click from drag on vertices (threshold-based, 4px mouse / 10px touch)
- Dispatch actions based on hit test results: add point, select vertex, delete vertex, drag body/vertex, rotate
- Expand hit-test radii for touch input (15px vs 9px for vertices/rotation, 14px vs 8px for polyline nearness)
- Manage mode switching between draw and navigation modes, toggling map interaction handlers
- Wire up the control panel: mode toggle, close-polygon, delete-vertex, delete-all, undo, redo, restart, share, bookmark buttons, and rotation slider
- Centralize context button visibility via `updateContextButtons()`
- Provide undo/redo for all polygon and bookmark mutations

## Inputs / Outputs

| Direction | What | Form |
|-----------|------|------|
| Input | Pointer events | pointerdown, pointermove, pointerup, pointerleave on canvas |
| Input | Double-click events | dblclick on canvas (desktop backward compat for closing polygons) |
| Input | Keyboard events | keydown on document (Delete/Backspace, Ctrl+Z undo, Ctrl+Y redo) |
| Input | Button clicks, slider changes | DOM events from the control panel |
| Output | Polygon state mutations | Calls to add/delete/move vertices, change rotation, move centroid |
| Output | Mode changes | Toggles map interaction handlers and canvas pointer events |
| Output | Context button visibility | `updateContextButtons()` shows/hides/reserves close-poly, delete-vertex, delete-all, undo, redo, restart buttons |

## Key Contracts

- All canvas interaction is gated by the current mode: only draw mode processes canvas events
- A pointerdown on a vertex does not immediately start a drag; it waits for enough movement to exceed a threshold (4px mouse, 10px touch/pen), otherwise it counts as a click (select)
- Three ways to close a polygon coexist: double-click (desktop), Close Polygon button (all platforms), tap/click first vertex (all platforms)
- Hover/delete-icon rendering on canvas is mouse-only (no hover concept on touch); touch users use the Delete Vertex button
- Keyboard delete only acts when a vertex is selected
- The rotation slider stays in sync with the polygon rotation, whether changed via slider or via rotation handle drag
- Every state-mutating action pushes to the undo stack before applying; the redo stack is cleared on each new push
- Undo/redo captures polygon state (points, centroid, rotation, closed flag) and bookmarks as a snapshot
- Continuous slider drags are coalesced into a single undo entry (pushed on first `input`, not on every tick)
- Restart clears all polygon and bookmark state with undo support
- The control panel must remain above both the map and canvas (highest z-index)
- `touch-action: none` on `#canvas` prevents browser gesture interference during draw mode
- All `.icon-btn` elements are 44x44px to meet accessibility touch target guidelines

## Button Column Order

The `#button-row` vertical flex column has a deliberate order. Do not reorder without understanding the layout contract:

| Position | Button(s) | Visibility | Why |
|----------|-----------|------------|-----|
| Top | share, bookmark, mode | Always visible | Anchor the column; never shift |
| Middle | undo, redo | Draw mode | Must sit above all conditional buttons — nothing appears above them so their Y position is always stable |
| Middle | delete-all | Draw mode | Always visible in draw mode; stable |
| Middle | restart | Draw mode + has content | Low-frequency toggle; sits below stable buttons |
| Bottom | close-poly, delete-vertex | Draw mode, reserved | Most volatile (toggle frequently mid-draw); placed last and use `visibility: hidden` so they never push anything above them |

`close-poly` and `delete-vertex` use `visibility: hidden` (`.reserved` class) within draw mode when their condition is not met, and `display: none` (`.hidden` class) outside draw mode.

## Expected Behavior

**Draw mode (mouse):**
- Clicking empty space adds a new vertex
- Clicking a vertex selects it; dragging a vertex moves it
- Hovering a vertex shows a delete icon; clicking the delete icon removes the vertex
- Dragging the polygon body translates the entire polygon
- Dragging the rotation handle rotates the polygon and updates the slider
- Double-clicking closes the polygon
- Clicking the first vertex (index 0) on an open polygon with >= 3 points closes it
- Close Polygon button is visible when polygon has >= 3 points and is open; in draw mode it always reserves layout space (invisible but present) when condition is not met
- Delete Vertex button is visible when a vertex is selected; in draw mode it always reserves layout space when no vertex is selected
- Delete/Backspace removes the selected vertex
- Ctrl+Z undoes the last action; Ctrl+Y redoes
- Undo/redo buttons reflect stack state (dimmed when empty)
- Restart button appears when polygon has points or bookmarks exist; clears everything

**Draw mode (touch/pen):**
- Same as mouse except: no hover effects, no canvas delete icons
- Larger hit-test radii (15px vertex/rotation, 14px polyline) for finger-friendly selection
- Higher drag threshold (10px) prevents accidental drags
- Delete Vertex button is the primary way to remove vertices
- Close Polygon button and first-vertex-tap are the primary ways to close polygons

**Navigation mode:**
- Canvas is non-interactive (pointer events pass through to the map)
- The polygon is visible but not editable
- All context buttons (close-poly, delete-vertex, delete-all, undo, redo, restart) are hidden (display: none, no space reserved)
