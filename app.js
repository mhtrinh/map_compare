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
let mode = 'draw'; // 'draw' | 'compare'

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
const DRAG_THRESHOLD = 4; // px — min movement to start a drag vs. count as a click

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupMap();
  setupCanvas();
  setupControls();
  attachDrawListeners();
  setMode('draw');
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
    setMode(mode === 'draw' ? 'compare' : 'draw');
  });

  slider.addEventListener('input', () => {
    polygon.rotation = parseInt(slider.value, 10);
    rotValue.textContent = polygon.rotation;
    render();
  });

  document.getElementById('delete-all-btn').addEventListener('click', resetPolygon);
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------
function setMode(newMode) {
  mode = newMode;
  const modeBtn = document.getElementById('mode-btn');
  const instructions = document.getElementById('instructions');

  if (mode === 'draw') {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    canvas.style.pointerEvents = 'auto';
    modeBtn.textContent = 'Switch to Compare';
    instructions.innerHTML = '<strong>Draw Mode:</strong> click to add points, double-click to close polygon';
  } else {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    canvas.style.pointerEvents = 'none';
    modeBtn.textContent = 'Switch to Draw';
    instructions.innerHTML = '<strong>Compare Mode:</strong> pan and zoom the map freely';
  }

  render();
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
function hitTest(x, y) {
  if (polygon.points.length === 0) return { type: 'empty' };

  // 1. Rotation handle
  const rh = getRotationHandlePos();
  if (dist(x, y, rh.x, rh.y) <= HANDLE_RADIUS + 2) {
    return { type: 'rotation-handle' };
  }

  const pts = computePixelPoints();

  // 2. Delete icons (checked before vertex handles so clicking ✕ doesn't trigger drag)
  for (let i = 0; i < pts.length; i++) {
    const ix = pts[i].x + 10;
    const iy = pts[i].y - 10;
    if (dist(x, y, ix, iy) <= 10) {
      return { type: 'delete-icon', index: i };
    }
  }

  // 3. Vertex handles (open or closed)
  for (let i = 0; i < pts.length; i++) {
    if (dist(x, y, pts[i].x, pts[i].y) <= HANDLE_RADIUS + 2) {
      return { type: 'vertex', index: i };
    }
  }

  // 4. Polygon body
  if (polygon.closed && pts.length >= 3 && pointInPolygon(x, y, pts)) {
    return { type: 'body' };
  }
  if (!polygon.closed && pts.length >= 2 && nearPolyline(x, y, pts)) {
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
  canvas.addEventListener('mousedown', onCanvasMousedown);
  canvas.addEventListener('mousemove', onCanvasMousemove);
  canvas.addEventListener('mouseup', onCanvasMouseup);
  canvas.addEventListener('dblclick', onCanvasDblclick);

  document.addEventListener('keydown', (e) => {
    if (mode !== 'draw') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertex !== null) {
      deleteVertex(selectedVertex);
    }
  });
}

function onCanvasMousedown(e) {
  if (mode !== 'draw') return;
  e.preventDefault();

  const x = e.offsetX;
  const y = e.offsetY;
  const hit = hitTest(x, y);

  if (hit.type === 'delete-icon') {
    deleteVertex(hit.index);
    return;
  }

  if (hit.type === 'vertex') {
    // Defer to mouseup to distinguish click (select) from drag
    pendingVertex = { index: hit.index, x, y };
    return;
  }

  if (hit.type === 'empty') {
    if (!polygon.closed) {
      selectedVertex = null;
      addPoint(x, y);
      render();
    }
    return;
  }

  if (hit.type === 'body') {
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
    drag = {
      type: 'rotation-handle',
      startX: x,
      startY: y,
    };
    return;
  }
}

function onCanvasMousemove(e) {
  const x = e.offsetX;
  const y = e.offsetY;

  // Resolve pendingVertex: enough movement → start drag; otherwise keep pending
  if (pendingVertex) {
    if (dist(x, y, pendingVertex.x, pendingVertex.y) > DRAG_THRESHOLD) {
      drag = { type: 'vertex', index: pendingVertex.index, startX: pendingVertex.x, startY: pendingVertex.y };
      pendingVertex = null;
    }
  }

  // Update hoveredVertex on every move
  if (!drag && !pendingVertex) {
    const hit = hitTest(x, y);
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

function onCanvasMouseup(e) {
  if (pendingVertex) {
    // Mouse didn't move enough to drag — treat as click → select
    selectedVertex = pendingVertex.index;
    pendingVertex = null;
    render();
  }
  drag = null;
}

function onCanvasDblclick(e) {
  if (mode !== 'draw') return;
  e.preventDefault();

  if (!polygon.closed && polygon.points.length >= 3) {
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit.type === 'empty' || hit.type === 'body' || hit.type === 'vertex') {
      polygon.closed = true;
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Vertex deletion and reset
// ---------------------------------------------------------------------------
function deleteVertex(index) {
  polygon.points.splice(index, 1);
  if (polygon.points.length < 3) polygon.closed = false;
  if (polygon.points.length === 0) {
    resetPolygon();
    return;
  }
  selectedVertex = null;
  hoveredVertex = null;
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
  render();
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
