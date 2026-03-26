'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EARTH_RADIUS = 6378137; // meters (WGS-84)
const HANDLE_RADIUS = 7;       // px — vertex handle hit radius
const ROT_HANDLE_DIST = 48;    // px — distance of rotation handle from centroid

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
let map;
let canvas;
let ctx;
let mode = 'draw'; // 'draw' | 'navigation'

const polygon = {
  points: [],          // [{dx, dy}] offsets in meters from centroid
  screenPos: { x: 0, y: 0 }, // centroid pixel position (screen-relative)
  rotation: 0,         // degrees
  closed: false,
};

// Drag state
let drag = null; // null or { type, startX, startY, origScreenPos, origPoints, origRotation, vertexIndex }

// Vertex selection/hover state
let hoveredVertex = null;  // index of vertex under mouse
let selectedVertex = null; // index of selected vertex
let pendingVertex = null;  // { index, x, y } — vertex mousedown not yet resolved as click or drag
const DRAG_THRESHOLD_MOUSE = 4;  // px — min movement for mouse
const DRAG_THRESHOLD_TOUCH = 10; // px — min movement for touch/pen
let activePointerType = 'mouse'; // 'mouse' | 'touch' | 'pen'

// Bookmark state
let bookmarks = []; // [{id, name, lat, lng, zoom}]

// Toast state
let toastTimeout = null;

// Undo/redo state
let undoStack = [];
let redoStack = [];
let sliderDragActive = false;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupMap();
  setupCanvas();
  setupControls();
  attachDrawListeners();

  const hash = window.location.hash.slice(1);
  if (hash) {
    deserializeState(hash);
  } else {
    setMode('navigation');
  }
});

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------
function setupMap() {
  map = L.map('map', {
    center: [48.8566, 2.3522], // Paris
    zoom: 10,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  map.on('zoomend moveend', () => {
    render();
  });
}

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
function setupCanvas() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();

  window.addEventListener('resize', onResize);
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function onResize() {
  const prevW = canvas.width;
  const prevH = canvas.height;

  resizeCanvas();

  if (prevW > 0 && prevH > 0) {
    polygon.screenPos.x = polygon.screenPos.x * (canvas.width / prevW);
    polygon.screenPos.y = polygon.screenPos.y * (canvas.height / prevH);
  }

  render();
}

// ---------------------------------------------------------------------------
// Controls setup
// ---------------------------------------------------------------------------
function setupControls() {
  const modeBtn = document.getElementById('mode-btn');
  const slider = document.getElementById('rotation-slider');
  const rotValue = document.getElementById('rotation-value');

  modeBtn.addEventListener('click', () => {
    setMode(mode === 'draw' ? 'navigation' : 'draw');
  });

  slider.addEventListener('input', () => {
    if (!sliderDragActive) {
      pushUndo();
      sliderDragActive = true;
    }
    polygon.rotation = parseInt(slider.value, 10);
    rotValue.textContent = polygon.rotation;
    render();
  });

  slider.addEventListener('change', () => {
    sliderDragActive = false;
  });

  document.getElementById('delete-all-btn').addEventListener('click', function() {
    pushUndo();
    resetPolygon();
  });
  document.getElementById('share-btn').addEventListener('click', onShareClick);
  document.getElementById('bookmark-btn').addEventListener('click', onBookmarkClick);
  document.getElementById('close-poly-btn').addEventListener('click', onClosePolygonClick);
  document.getElementById('delete-vertex-btn').addEventListener('click', onDeleteVertexClick);
  document.getElementById('restart-btn').addEventListener('click', restartAll);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------
function setMode(newMode) {
  mode = newMode;
  const modeBtn = document.getElementById('mode-btn');

  if (mode === 'draw') {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    canvas.style.pointerEvents = 'auto';
    modeBtn.textContent = '\uD83D\uDDFA\uFE0F'; // map icon — click to go back to navigation
    modeBtn.title = 'Switch to Navigation';
  } else {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    canvas.style.pointerEvents = 'none';
    modeBtn.textContent = '\u270F\uFE0F'; // pencil icon — click to enter draw mode
    modeBtn.title = 'Switch to Draw';
  }

  updateContextButtons();
  showModeToast(mode);
  render();
}

function showModeToast(currentMode) {
  const toast = document.getElementById('mode-toast');
  var label = currentMode === 'draw' ? 'Draw Mode' : 'Navigation Mode';
  toast.textContent = label;

  if (toastTimeout !== null) {
    clearTimeout(toastTimeout);
  }

  toast.classList.add('visible');
  toastTimeout = setTimeout(function() {
    toast.classList.remove('visible');
    toastTimeout = null;
  }, 2000);
}

// ---------------------------------------------------------------------------
// Coordinate math
// ---------------------------------------------------------------------------

/**
 * Convert meters to pixels at a given latitude and zoom level.
 * Uses Leaflet's EPSG:3857 Web Mercator scale.
 */
function metersToPixels(meters, latDeg, zoom) {
  const latRad = latDeg * Math.PI / 180;
  const scale = 256 * Math.pow(2, zoom);
  return meters * scale * Math.cos(latRad) / (2 * Math.PI * EARTH_RADIUS);
}

function pixelsToMeters(pixels, latDeg, zoom) {
  const latRad = latDeg * Math.PI / 180;
  const scale = 256 * Math.pow(2, zoom);
  return pixels * (2 * Math.PI * EARTH_RADIUS) / (scale * Math.cos(latRad));
}

/**
 * Get the geographic latitude at the polygon centroid screen position.
 */
function getCentroidLat() {
  const latlng = map.containerPointToLatLng(
    L.point(polygon.screenPos.x, polygon.screenPos.y)
  );
  return latlng.lat;
}

/**
 * Compute pixel positions of all polygon vertices on the canvas,
 * applying rotation and meter-to-pixel conversion.
 */
function computePixelPoints() {
  if (polygon.points.length === 0) return [];

  const zoom = map.getZoom();
  const lat = getCentroidLat();
  const angleRad = polygon.rotation * Math.PI / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const cx = polygon.screenPos.x;
  const cy = polygon.screenPos.y;

  return polygon.points.map(({ dx, dy }) => {
    // Apply rotation matrix to meter offsets
    const rdx = cosA * dx - sinA * dy;
    const rdy = sinA * dx + cosA * dy;
    // Convert to pixels
    const px = metersToPixels(rdx, lat, zoom);
    const py = metersToPixels(rdy, lat, zoom);
    return { x: cx + px, y: cy + py };
  });
}

/**
 * Get screen position of the rotation handle.
 */
function getRotationHandlePos() {
  const angleRad = polygon.rotation * Math.PI / 180;
  return {
    x: polygon.screenPos.x + ROT_HANDLE_DIST * Math.cos(angleRad - Math.PI / 2),
    y: polygon.screenPos.y + ROT_HANDLE_DIST * Math.sin(angleRad - Math.PI / 2),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (polygon.points.length === 0) return;

  const pts = computePixelPoints();

  drawPolygon(pts);

  if (mode === 'draw') {
    drawVertexHandles(pts, hoveredVertex, selectedVertex);
    drawRotationHandle();
  }
}

function drawPolygon(pts) {
  if (pts.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  if (polygon.closed) {
    ctx.closePath();
    ctx.fillStyle = 'rgba(51, 136, 255, 0.2)';
    ctx.fill();
  }
  ctx.strokeStyle = '#3388ff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw individual point dots for open polygons
  if (!polygon.closed) {
    pts.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#3388ff';
      ctx.fill();
    });
  }
}

function drawVertexHandles(pts, hoveredIndex, selectedIndex) {
  pts.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, HANDLE_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = (i === selectedIndex) ? 'yellow' : 'white';
    ctx.fill();
    ctx.strokeStyle = '#3388ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (i === hoveredIndex) {
      drawDeleteIcon(pt);
    }
  });
}

function drawDeleteIcon(pt) {
  const ix = pt.x + 10;
  const iy = pt.y - 10;
  const r = 5;
  ctx.save();
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ix - r, iy - r);
  ctx.lineTo(ix + r, iy + r);
  ctx.moveTo(ix + r, iy - r);
  ctx.lineTo(ix - r, iy + r);
  ctx.stroke();
  ctx.restore();
}

function drawRotationHandle() {
  const pos = getRotationHandlePos();
  const cx = polygon.screenPos.x;
  const cy = polygon.screenPos.y;

  // Line from centroid to handle
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(pos.x, pos.y);
  ctx.strokeStyle = 'rgba(255, 100, 0, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Handle circle
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, HANDLE_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = '#ff6400';
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Returns { type: 'rotation-handle' | 'delete-icon' | 'vertex' | 'body' | 'empty', index? }
 */
function hitTest(x, y, pointerType) {
  if (polygon.points.length === 0) return { type: 'empty' };

  var isTouch = (pointerType === 'touch' || pointerType === 'pen');
  var handleRadius = isTouch ? HANDLE_RADIUS + 8 : HANDLE_RADIUS + 2;
  var deleteRadius = isTouch ? 16 : 10;
  var polylineThreshold = isTouch ? 14 : 8;

  // 1. Rotation handle
  const rh = getRotationHandlePos();
  if (dist(x, y, rh.x, rh.y) <= handleRadius) {
    return { type: 'rotation-handle' };
  }

  const pts = computePixelPoints();

  // 2. Delete icons (checked before vertex handles so clicking X doesn't trigger drag)
  // Skip for touch — touch users use the Delete Vertex button instead
  if (!isTouch) {
    for (let i = 0; i < pts.length; i++) {
      const ix = pts[i].x + 10;
      const iy = pts[i].y - 10;
      if (dist(x, y, ix, iy) <= deleteRadius) {
        return { type: 'delete-icon', index: i };
      }
    }
  }

  // 3. Vertex handles (open or closed)
  for (let i = 0; i < pts.length; i++) {
    if (dist(x, y, pts[i].x, pts[i].y) <= handleRadius) {
      return { type: 'vertex', index: i };
    }
  }

  // 4. Polygon body
  if (polygon.closed && pts.length >= 3 && pointInPolygon(x, y, pts)) {
    return { type: 'body' };
  }
  if (!polygon.closed && pts.length >= 2 && nearPolyline(x, y, pts, polylineThreshold)) {
    return { type: 'body' };
  }

  return { type: 'empty' };
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function nearPolyline(x, y, pts, threshold = 8) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i], pts[i + 1]) < threshold) return true;
  }
  return false;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, a.x, a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return dist(px, py, a.x + t * dx, a.y + t * dy);
}

// ---------------------------------------------------------------------------
// Interaction handlers
// ---------------------------------------------------------------------------
function attachDrawListeners() {
  canvas.addEventListener('pointerdown', onCanvasPointerdown);
  canvas.addEventListener('pointermove', onCanvasPointermove);
  canvas.addEventListener('pointerup', onCanvasPointerup);
  canvas.addEventListener('pointerleave', onCanvasPointerleave);
  canvas.addEventListener('dblclick', onCanvasDblclick);

  document.addEventListener('keydown', (e) => {
    if (mode !== 'draw') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertex !== null) {
      deleteVertex(selectedVertex);
    }
  });
}

function onCanvasPointerdown(e) {
  if (mode !== 'draw') return;
  e.preventDefault();

  activePointerType = e.pointerType;
  const x = e.offsetX;
  const y = e.offsetY;
  const hit = hitTest(x, y, activePointerType);

  if (hit.type === 'delete-icon') {
    deleteVertex(hit.index);
    return;
  }

  if (hit.type === 'vertex') {
    // Defer to pointerup to distinguish click (select) from drag
    pendingVertex = { index: hit.index, x, y };
    return;
  }

  if (hit.type === 'empty') {
    if (!polygon.closed) {
      pushUndo();
      selectedVertex = null;
      addPoint(x, y);
      updateContextButtons();
      render();
    }
    return;
  }

  if (hit.type === 'body') {
    pushUndo();
    selectedVertex = null;
    drag = {
      type: 'body',
      startX: x,
      startY: y,
      origScreenPos: { ...polygon.screenPos },
    };
    return;
  }

  if (hit.type === 'rotation-handle') {
    pushUndo();
    drag = {
      type: 'rotation-handle',
      startX: x,
      startY: y,
    };
    return;
  }
}

function onCanvasPointermove(e) {
  const x = e.offsetX;
  const y = e.offsetY;

  // Resolve pendingVertex: enough movement → start drag; otherwise keep pending
  if (pendingVertex) {
    var threshold = (activePointerType === 'mouse') ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
    if (dist(x, y, pendingVertex.x, pendingVertex.y) > threshold) {
      pushUndo();
      drag = { type: 'vertex', index: pendingVertex.index, startX: pendingVertex.x, startY: pendingVertex.y };
      pendingVertex = null;
    }
  }

  // Update hoveredVertex on every move — mouse only (no hover concept on touch)
  if (!drag && !pendingVertex && activePointerType === 'mouse') {
    const hit = hitTest(x, y, activePointerType);
    const newHovered = (hit.type === 'vertex' || hit.type === 'delete-icon') ? hit.index : null;
    if (newHovered !== hoveredVertex) {
      hoveredVertex = newHovered;
      render();
    }
  }

  if (!drag) return;
  e.preventDefault();

  if (drag.type === 'body') {
    polygon.screenPos.x = drag.origScreenPos.x + (x - drag.startX);
    polygon.screenPos.y = drag.origScreenPos.y + (y - drag.startY);
    render();
    return;
  }

  if (drag.type === 'vertex') {
    const zoom = map.getZoom();
    const lat = getCentroidLat();
    const angleRad = polygon.rotation * Math.PI / 180;
    const cosA = Math.cos(-angleRad);
    const sinA = Math.sin(-angleRad);

    // Delta from centroid in screen pixels
    const dpx = x - polygon.screenPos.x;
    const dpy = y - polygon.screenPos.y;

    // Rotate back to unrotated frame
    const rdpx = cosA * dpx - sinA * dpy;
    const rdpy = sinA * dpx + cosA * dpy;

    // Convert to meters
    polygon.points[drag.index] = {
      dx: pixelsToMeters(rdpx, lat, zoom),
      dy: pixelsToMeters(rdpy, lat, zoom),
    };

    render();
    return;
  }

  if (drag.type === 'rotation-handle') {
    const dx = x - polygon.screenPos.x;
    const dy = y - polygon.screenPos.y;
    // Angle from centroid to mouse, offset by 90° because the handle is drawn upward
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    polygon.rotation = Math.round(angleDeg);

    const slider = document.getElementById('rotation-slider');
    const rotValue = document.getElementById('rotation-value');
    // Normalize for slider range [-180, 180]
    let norm = ((polygon.rotation + 180) % 360) - 180;
    slider.value = norm;
    rotValue.textContent = norm;
    polygon.rotation = norm;

    render();
    return;
  }
}

function onCanvasPointerup(e) {
  if (pendingVertex) {
    // Pointer didn't move enough to drag — treat as click
    // If tapping first vertex on an open polygon with >= 3 points, close it
    if (pendingVertex.index === 0 && polygon.points.length >= 3 && !polygon.closed) {
      pushUndo();
      polygon.closed = true;
      selectedVertex = null;
      pendingVertex = null;
      updateContextButtons();
      render();
    } else {
      selectedVertex = pendingVertex.index;
      pendingVertex = null;
      updateContextButtons();
      render();
    }
  }
  drag = null;
}

function onCanvasPointerleave(e) {
  if (hoveredVertex !== null) {
    hoveredVertex = null;
    render();
  }
}

function onCanvasDblclick(e) {
  if (mode !== 'draw') return;
  e.preventDefault();

  if (!polygon.closed && polygon.points.length >= 3) {
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit.type === 'empty' || hit.type === 'body' || hit.type === 'vertex') {
      pushUndo();
      polygon.closed = true;
      updateContextButtons();
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Context buttons (Close Polygon, Delete Vertex, Delete All)
// ---------------------------------------------------------------------------

function updateContextButtons() {
  var closeBtn = document.getElementById('close-poly-btn');
  var deleteVertexBtn = document.getElementById('delete-vertex-btn');
  var deleteAllBtn = document.getElementById('delete-all-btn');
  var undoBtn = document.getElementById('undo-btn');
  var redoBtn = document.getElementById('redo-btn');
  var restartBtn = document.getElementById('restart-btn');

  if (mode === 'draw') {
    // Close Polygon: visible when drawing, >= 3 points, not yet closed
    if (polygon.points.length >= 3 && !polygon.closed) {
      closeBtn.classList.remove('hidden');
    } else {
      closeBtn.classList.add('hidden');
    }

    // Delete Vertex: visible when a vertex is selected
    if (selectedVertex !== null) {
      deleteVertexBtn.classList.remove('hidden');
    } else {
      deleteVertexBtn.classList.add('hidden');
    }

    // Delete All: always visible in draw mode
    deleteAllBtn.classList.remove('hidden');

    // Undo: always visible in draw mode, dimmed when stack empty
    undoBtn.classList.remove('hidden');
    if (undoStack.length === 0) {
      undoBtn.classList.add('disabled');
    } else {
      undoBtn.classList.remove('disabled');
    }

    // Redo: always visible in draw mode, dimmed when stack empty
    redoBtn.classList.remove('hidden');
    if (redoStack.length === 0) {
      redoBtn.classList.add('disabled');
    } else {
      redoBtn.classList.remove('disabled');
    }

    // Restart: visible when polygon has points OR bookmarks exist
    if (polygon.points.length > 0 || bookmarks.length > 0) {
      restartBtn.classList.remove('hidden');
    } else {
      restartBtn.classList.add('hidden');
    }
  } else {
    closeBtn.classList.add('hidden');
    deleteVertexBtn.classList.add('hidden');
    deleteAllBtn.classList.add('hidden');
    undoBtn.classList.add('hidden');
    redoBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
  }
}

function onClosePolygonClick() {
  if (mode !== 'draw') return;
  if (polygon.closed) return;
  if (polygon.points.length < 3) return;

  pushUndo();
  polygon.closed = true;
  updateContextButtons();
  render();
}

function onDeleteVertexClick() {
  if (mode !== 'draw') return;
  if (selectedVertex === null) return;

  deleteVertex(selectedVertex);
}

// ---------------------------------------------------------------------------
// Vertex deletion and reset
// ---------------------------------------------------------------------------
function deleteVertex(index) {
  pushUndo();
  polygon.points.splice(index, 1);
  if (polygon.points.length < 3) polygon.closed = false;
  if (polygon.points.length === 0) {
    resetPolygon();
    return;
  }
  selectedVertex = null;
  hoveredVertex = null;
  updateContextButtons();
  render();
}

function resetPolygon() {
  polygon.points = [];
  polygon.closed = false;
  polygon.rotation = 0;
  polygon.screenPos = { x: 0, y: 0 };
  const slider = document.getElementById('rotation-slider');
  const rotValue = document.getElementById('rotation-value');
  slider.value = 0;
  rotValue.textContent = '0';
  selectedVertex = null;
  hoveredVertex = null;
  pendingVertex = null;
  drag = null;
  updateContextButtons();
  render();
}

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

function captureState() {
  return {
    points: polygon.points.map(function(p) { return { dx: p.dx, dy: p.dy }; }),
    screenPos: { x: polygon.screenPos.x, y: polygon.screenPos.y },
    rotation: polygon.rotation,
    closed: polygon.closed,
    bookmarks: bookmarks.map(function(b) {
      return { id: b.id, name: b.name, lat: b.lat, lng: b.lng, zoom: b.zoom };
    }),
  };
}

function restoreState(state) {
  polygon.points = state.points.map(function(p) { return { dx: p.dx, dy: p.dy }; });
  polygon.screenPos = { x: state.screenPos.x, y: state.screenPos.y };
  polygon.rotation = state.rotation;
  polygon.closed = state.closed;
  bookmarks = state.bookmarks.map(function(b) {
    return { id: b.id, name: b.name, lat: b.lat, lng: b.lng, zoom: b.zoom };
  });

  selectedVertex = null;
  hoveredVertex = null;
  pendingVertex = null;
  drag = null;

  var slider = document.getElementById('rotation-slider');
  var rotValue = document.getElementById('rotation-value');
  slider.value = polygon.rotation;
  rotValue.textContent = polygon.rotation;

  renderBookmarkPanel();
  updateContextButtons();
  render();
}

function pushUndo() {
  undoStack.push(captureState());
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureState());
  restoreState(undoStack.pop());
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureState());
  restoreState(redoStack.pop());
}

function restartAll() {
  pushUndo();
  polygon.points = [];
  polygon.closed = false;
  polygon.rotation = 0;
  polygon.screenPos = { x: 0, y: 0 };
  bookmarks = [];

  var slider = document.getElementById('rotation-slider');
  var rotValue = document.getElementById('rotation-value');
  slider.value = 0;
  rotValue.textContent = '0';

  selectedVertex = null;
  hoveredVertex = null;
  pendingVertex = null;
  drag = null;

  renderBookmarkPanel();
  updateContextButtons();
  render();
}

// ---------------------------------------------------------------------------
// Share: serialize / deserialize state via URL hash
// ---------------------------------------------------------------------------

function serializeState() {
  var hasPolygon = polygon.points.length > 0;
  var hasBookmarks = bookmarks.length > 0;

  if (!hasPolygon && !hasBookmarks) {
    return false;
  }

  const center = map.getCenter();
  const zoom = map.getZoom();

  const payload = {
    v: 1,
    map: { lat: center.lat, lng: center.lng, z: zoom },
  };

  if (hasPolygon) {
    const centroidLatLng = map.containerPointToLatLng(
      L.point(polygon.screenPos.x, polygon.screenPos.y)
    );
    payload.centroid = { lat: centroidLatLng.lat, lng: centroidLatLng.lng };
    payload.points = polygon.points.map(function(p) { return [p.dx, p.dy]; });
    payload.rotation = polygon.rotation;
    payload.closed = polygon.closed;
  }

  if (hasBookmarks) {
    payload.bookmarks = bookmarks;
  }

  window.location.hash = btoa(JSON.stringify(payload));
  return true;
}

function deserializeState(hash) {
  try {
    var json = atob(hash);
    var data = JSON.parse(json);

    if (!data.v || !data.map) {
      console.warn('deserializeState: missing required fields');
      setMode('navigation');
      return;
    }

    map.setView([data.map.lat, data.map.lng], data.map.z, { animate: false });

    if (data.centroid && data.points) {
      var screenPt = map.latLngToContainerPoint(
        L.latLng(data.centroid.lat, data.centroid.lng)
      );
      polygon.screenPos = { x: screenPt.x, y: screenPt.y };

      polygon.points = data.points.map(function(arr) {
        return { dx: arr[0], dy: arr[1] };
      });
      polygon.rotation = data.rotation || 0;
      polygon.closed = !!data.closed;

      var slider = document.getElementById('rotation-slider');
      var rotValue = document.getElementById('rotation-value');
      slider.value = polygon.rotation;
      rotValue.textContent = polygon.rotation;
    }

    if (Array.isArray(data.bookmarks)) {
      bookmarks = data.bookmarks;
      renderBookmarkPanel();
    }

    setMode('navigation');
  } catch (err) {
    console.warn('deserializeState: invalid hash data', err);
    setMode('navigation');
  }
}

function showButtonFeedback(btn, message) {
  btn.setAttribute('data-feedback', message);
  btn.classList.add('feedback');
  setTimeout(function() {
    btn.classList.remove('feedback');
    btn.removeAttribute('data-feedback');
  }, 1500);
}

function onShareClick() {
  var btn = document.getElementById('share-btn');

  if (!serializeState()) {
    showButtonFeedback(btn, 'Nothing to share');
    return;
  }

  navigator.clipboard.writeText(window.location.href).then(function() {
    showButtonFeedback(btn, 'Copied!');
  });
}

// ---------------------------------------------------------------------------
// Point addition
// ---------------------------------------------------------------------------
function addPoint(x, y) {
  if (polygon.points.length === 0) {
    // First point: set centroid to clicked position, offset is zero
    polygon.screenPos = { x, y };
    polygon.points.push({ dx: 0, dy: 0 });
    return;
  }

  const zoom = map.getZoom();
  const lat = getCentroidLat();
  const angleRad = polygon.rotation * Math.PI / 180;
  const cosA = Math.cos(-angleRad);
  const sinA = Math.sin(-angleRad);

  // Delta from centroid in screen pixels
  const dpx = x - polygon.screenPos.x;
  const dpy = y - polygon.screenPos.y;

  // Rotate back to unrotated frame
  const rdpx = cosA * dpx - sinA * dpy;
  const rdpy = sinA * dpx + cosA * dpy;

  polygon.points.push({
    dx: pixelsToMeters(rdpx, lat, zoom),
    dy: pixelsToMeters(rdpy, lat, zoom),
  });
}

// ---------------------------------------------------------------------------
// Bookmark system
// ---------------------------------------------------------------------------

function onBookmarkClick() {
  var center = map.getCenter();
  var zoom = map.getZoom();
  var id = Date.now();

  fetchBookmarkName(center.lat, center.lng, zoom).then(function(name) {
    bookmarks.push({ id: id, name: name, lat: center.lat, lng: center.lng, zoom: zoom });
    renderBookmarkPanel();
    serializeState();
  });
}

function fetchBookmarkName(lat, lng, zoom) {
  var url = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&zoom=' + zoom;
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 3000);

  return fetch(url, { signal: controller.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      clearTimeout(timeoutId);
      if (data.address) {
        var name = data.address.city || data.address.town || data.address.village || data.address.county || '';
        if (name) return name;
      }
      if (data.display_name) {
        return data.display_name.substring(0, 30);
      }
      return 'Bookmark ' + (bookmarks.length + 1);
    })
    .catch(function() {
      clearTimeout(timeoutId);
      return 'Bookmark ' + (bookmarks.length + 1);
    });
}

function renderBookmarkPanel() {
  var existing = document.getElementById('bookmark-panel');

  if (bookmarks.length === 0) {
    if (existing) existing.remove();
    return;
  }

  var panel = existing;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'bookmark-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = '';

  bookmarks.forEach(function(bm) {
    var row = document.createElement('div');
    row.className = 'bookmark-row';

    var nav = document.createElement('span');
    nav.className = 'bookmark-navigate';
    nav.textContent = '\u{1F3AF}';
    nav.title = 'Go to ' + bm.name;
    nav.addEventListener('click', function() { navigateToBookmark(bm.id); });

    var name = document.createElement('span');
    name.className = 'bookmark-name';
    name.textContent = bm.name;
    name.title = bm.name;
    name.addEventListener('click', function() { startEditBookmarkName(bm.id); });

    var del = document.createElement('span');
    del.className = 'bookmark-delete';
    del.textContent = '\u00D7';
    del.title = 'Delete bookmark';
    del.addEventListener('click', function() { deleteBookmark(bm.id); });

    row.appendChild(nav);
    row.appendChild(name);
    row.appendChild(del);
    panel.appendChild(row);
  });
}

function navigateToBookmark(id) {
  var bm = bookmarks.find(function(b) { return b.id === id; });
  if (!bm) return;
  map.setView([bm.lat, bm.lng], bm.zoom);
}

function startEditBookmarkName(id) {
  var bm = bookmarks.find(function(b) { return b.id === id; });
  if (!bm) return;

  var panel = document.getElementById('bookmark-panel');
  if (!panel) return;

  var rows = panel.querySelectorAll('.bookmark-row');
  var idx = bookmarks.indexOf(bm);
  if (idx < 0 || idx >= rows.length) return;

  var row = rows[idx];
  var nameSpan = row.querySelector('.bookmark-name');
  if (!nameSpan) return;

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'bookmark-name-input';
  input.value = bm.name;

  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  var saved = false;
  function save() {
    if (saved) return;
    saved = true;
    var newName = input.value.trim();
    if (newName) bm.name = newName;
    renderBookmarkPanel();
    serializeState();
  }

  function cancel() {
    if (saved) return;
    saved = true;
    renderBookmarkPanel();
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', save);
}

function deleteBookmark(id) {
  bookmarks = bookmarks.filter(function(b) { return b.id !== id; });
  renderBookmarkPanel();
  serializeState();
}
