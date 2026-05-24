// ─── Display / window-bounds helpers ─────────────────────────────────────────
// Centralized math for sizing & placing Electron BrowserWindows so they stay
// inside a real display's work area across:
//   • multi-monitor setups
//   • high-DPI displays
//   • monitors disconnected since the bounds were last saved
//   • laptop docks where work-area can shrink (taskbar / Dock visible)
//
// All functions return { x, y, width, height } in DIPs (Electron's native
// coordinate system for BrowserWindow APIs).

const { screen } = require('electron');

/**
 * Find the display that best contains the given bounds, falling back to the
 * primary display if no overlap exists. We use overlap area rather than the
 * window center so a window straddling two displays still gets the right one.
 */
function pickDisplayForBounds(bounds) {
  const displays = screen.getAllDisplays();
  if (!displays.length) return screen.getPrimaryDisplay();
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return screen.getPrimaryDisplay();
  }

  let best = null;
  let bestArea = 0;
  for (const d of displays) {
    const wa = d.workArea;
    const ix1 = Math.max(bounds.x, wa.x);
    const iy1 = Math.max(bounds.y, wa.y);
    const ix2 = Math.min(bounds.x + (bounds.width || 0), wa.x + wa.width);
    const iy2 = Math.min(bounds.y + (bounds.height || 0), wa.y + wa.height);
    const overlap = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    if (overlap > bestArea) { best = d; bestArea = overlap; }
  }
  if (best) return best;
  // No overlap means the window is entirely off-screen (display gone). Use the
  // display nearest the window's center as a graceful recovery.
  const cx = bounds.x + (bounds.width || 0) / 2;
  const cy = bounds.y + (bounds.height || 0) / 2;
  try { return screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }); }
  catch { return screen.getPrimaryDisplay(); }
}

/**
 * Clamp `bounds` so it fully fits inside its display's work area. Resizes the
 * window down if larger than the work area, then nudges it back inside.
 *
 * `min` is a floor used when the display is comically small.
 */
function clampBoundsToWorkArea(bounds, { min = { width: 480, height: 360 } } = {}) {
  if (!bounds) return null;
  const display = pickDisplayForBounds(bounds);
  const wa = display.workArea;

  let width  = Math.max(min.width,  Math.min(Number(bounds.width)  || wa.width,  wa.width));
  let height = Math.max(min.height, Math.min(Number(bounds.height) || wa.height, wa.height));

  let x = typeof bounds.x === 'number' ? bounds.x : wa.x + Math.round((wa.width  - width) / 2);
  let y = typeof bounds.y === 'number' ? bounds.y : wa.y + Math.round((wa.height - height) / 2);

  // Nudge inside the work area without changing the size.
  if (x + width  > wa.x + wa.width)  x = wa.x + wa.width  - width;
  if (y + height > wa.y + wa.height) y = wa.y + wa.height - height;
  if (x < wa.x) x = wa.x;
  if (y < wa.y) y = wa.y;

  return { x, y, width, height };
}

/**
 * Compute centered bounds for a child window of `parent` (or the focused
 * display if `parent` is missing). Useful for auth popups, modals, etc.
 */
function centerOnParent(parent, width, height, { min = { width: 360, height: 360 } } = {}) {
  let display;
  if (parent && !parent.isDestroyed()) {
    try {
      const pb = parent.getBounds();
      display = screen.getDisplayMatching(pb);
    } catch { display = screen.getPrimaryDisplay(); }
  } else {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea;

  // Leave a small breathing margin so child windows don't touch the work-area edge.
  const margin = 24;
  const maxW = Math.max(min.width,  wa.width  - margin * 2);
  const maxH = Math.max(min.height, wa.height - margin * 2);
  const w = Math.max(min.width,  Math.min(width  || min.width,  maxW));
  const h = Math.max(min.height, Math.min(height || min.height, maxH));

  let x;
  let y;
  if (parent && !parent.isDestroyed()) {
    try {
      const pb = parent.getBounds();
      x = Math.round(pb.x + (pb.width  - w) / 2);
      y = Math.round(pb.y + (pb.height - h) / 2);
    } catch {
      x = wa.x + Math.round((wa.width  - w) / 2);
      y = wa.y + Math.round((wa.height - h) / 2);
    }
  } else {
    x = wa.x + Math.round((wa.width  - w) / 2);
    y = wa.y + Math.round((wa.height - h) / 2);
  }

  // Clamp into the same work area.
  return clampBoundsToWorkArea({ x, y, width: w, height: h }, { min });
}

/**
 * Returns true when the bounds describe a window that is at least partially
 * visible on some currently-attached display. Used to decide whether a saved
 * bounds object is still trustworthy after monitors have been moved/removed.
 */
function isOnScreen(bounds, { minVisible = 100 } = {}) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
  for (const d of screen.getAllDisplays()) {
    const wa = d.workArea;
    const ix1 = Math.max(bounds.x, wa.x);
    const iy1 = Math.max(bounds.y, wa.y);
    const ix2 = Math.min(bounds.x + (bounds.width  || 0), wa.x + wa.width);
    const iy2 = Math.min(bounds.y + (bounds.height || 0), wa.y + wa.height);
    if ((ix2 - ix1) >= minVisible && (iy2 - iy1) >= minVisible) return true;
  }
  return false;
}

module.exports = {
  pickDisplayForBounds,
  clampBoundsToWorkArea,
  centerOnParent,
  isOnScreen,
};
