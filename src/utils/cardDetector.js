/**
 * Robust multi-card detector — projection + fixed grid + validation.
 *
 * Key insight from testing (1755×1241, 11 cards/page, 3+3+3+2 grid):
 * - Column cuts: found by searching around evenly-spaced anchor points
 *   (step = contentWidth / estCols) with ±100px search window
 * - Row cuts: found by searching around evenly-spaced anchor points
 *   (step = contentHeight / estRows) with ±50px search window
 * - Grid cells at df >= 0.012 → valid cards
 * - NO MERGING NEEDED — grid cells already align with card boundaries
 */

function loadImageToCanvas(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}

function cropCanvas(canvas, x, y, w, h) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = document.createElement('canvas');
  out.width = Math.min(w, canvas.width - x);
  out.height = Math.min(h, canvas.height - y);
  out.getContext('2d').drawImage(canvas, x, y, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function imageToGrayAndProjections(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const imgData = ctx.getImageData(0, 0, W, H);
  const gray = new Float32Array(W * H);
  const vp = new Float32Array(W); // dark pixels per column
  const hp = new Float32Array(H); // dark pixels per row

  for (let i = 0; i < W * H; i++) {
    const g =
      0.299 * imgData.data[i * 4] +
      0.587 * imgData.data[i * 4 + 1] +
      0.114 * imgData.data[i * 4 + 2];
    gray[i] = g;
    if (g < 140) {
      vp[i % W]++;
      hp[Math.floor(i / W)]++;
    }
  }
  return { gray, vp, hp, W, H };
}

function findContentBounds(proj, total) {
  const mn = proj.reduce((a, b) => Math.min(a, b), Infinity);
  const mx = proj.reduce((a, b) => Math.max(a, b), -Infinity);
  const threshold = mn + (mx - mn) * 0.10;
  let start = 0;
  for (let i = 0; i < total; i++) {
    if (proj[i] > threshold) { start = Math.max(0, i - 10); break; }
  }
  let end = total;
  for (let i = total - 1; i >= 0; i--) {
    if (proj[i] > threshold) { end = Math.min(total, i + 10); break; }
  }
  return { start, end };
}

/**
 * Find column cuts using projection minima around evenly-spaced anchor points.
 * @param {Float32Array} rawVp - raw vertical projection (no smoothing needed)
 */
function findColCuts(rawVp, W, x0, x1) {
  const cW = x1 - x0;
  const estCols = Math.max(2, Math.min(5, Math.round(cW / 577)));
  if (estCols <= 1) return { cuts: [], estCols: 1 };

  const step = cW / estCols; // correct: step = contentWidth / estCols
  const cuts = [];

  for (let i = 1; i < estCols; i++) {
    const exp = x0 + i * step;
    const prev = i > 1 ? x0 + (i - 1) * step : x0;
    const next = i < estCols - 1 ? x0 + (i + 1) * step : x1;
    const mid = (prev + next) / 2;
    const a = Math.max(x0, Math.round(mid - 100));
    const b = Math.min(W, Math.round(mid + 100));
    let minPos = a;
    let minVal = Infinity;
    for (let x = a; x < b; x++) {
      if (rawVp[x] < minVal) { minVal = rawVp[x]; minPos = x; }
    }
    cuts.push(minPos);
  }
  return { cuts: cuts.sort((a, b) => a - b), estCols };
}

/**
 * Find row cuts using raw horizontal projection minima around evenly-spaced anchor points.
 */
function findRowCuts(rawHp, H, y0, y1) {
  const cH = y1 - y0;
  const estRows = Math.max(2, Math.min(5, Math.round(cH / 302)));
  if (estRows <= 1) return { cuts: [], estRows: 1 };

  const step = cH / estRows;
  const cuts = [];

  for (let i = 1; i < estRows; i++) {
    const exp = y0 + i * step;
    const prev = i > 1 ? y0 + (i - 1) * step : y0;
    const next = i < estRows - 1 ? y0 + (i + 1) * step : y1;
    const mid = (prev + next) / 2;
    const a = Math.max(y0, Math.round(mid - 50));
    const b = Math.min(H, Math.round(mid + 50));
    let minPos = a;
    let minVal = Infinity;
    for (let y = a; y <= b; y++) {
      if (rawHp[y] < minVal) { minVal = rawHp[y]; minPos = y; }
    }
    cuts.push(minPos);
  }
  return { cuts: cuts.sort((a, b) => a - b), estRows };
}

/** Compute dark fraction for a region. */
function darkFraction(gray, W, H, x, y, w, h) {
  const x2 = Math.min(W, Math.round(x + w));
  const y2 = Math.min(H, Math.round(y + h));
  const x1 = Math.max(0, Math.round(x));
  const y1 = Math.max(0, Math.round(y));
  const tw = x2 - x1;
  const th = y2 - y1;
  const total = tw * th;
  if (total <= 0) return 0;
  let dark = 0;
  for (let row = y1; row < y2; row++) {
    const base = row * W;
    for (let col = x1; col < x2; col++) {
      if (gray[base + col] < 140) dark++;
    }
  }
  return dark / total;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function detectAndSplitCards(imageUrl) {
  const canvas = await loadImageToCanvas(imageUrl);
  const { gray, vp: rawVp, hp: rawHp, W, H } = imageToGrayAndProjections(canvas);

  // Content bounds
  const { start: x0, end: x1 } = findContentBounds(rawVp, W);
  const { start: y0, end: y1 } = findContentBounds(rawHp, H);

  // Find cuts
  const { cuts: vCuts, estCols } = findColCuts(rawVp, W, x0, x1);
  const { cuts: hCuts, estRows } = findRowCuts(rawHp, H, y0, y1);

  const vBounds = [0, ...vCuts, W];
  const hBounds = [0, ...hCuts, H];

  // Extract all grid cells
  const cells = [];
  for (let vi = 0; vi < vBounds.length - 1; vi++) {
    for (let hi = 0; hi < hBounds.length - 1; hi++) {
      const x = vBounds[vi] + 4;
      const y = hBounds[hi] + 4;
      const x2 = vBounds[vi + 1] - 4;
      const y2 = hBounds[hi + 1] - 4;
      const w = x2 - x;
      const h = y2 - y;
      if (w < 80 || h < 50) continue;

      const df = darkFraction(gray, W, H, x, y, w, h);
      const aspect = w / h;

      // Accept cells with sufficient dark content and valid aspect ratio
      // df >= 0.012 captures sparse logo-only cards while filtering noise
      if (df >= 0.012 && aspect >= 0.3 && aspect <= 4.5) {
        cells.push({ x, y, w, h, df });
      }
    }
  }

  // Fallback: if projection approach gives too few cells, use fixed grid
  if (cells.length < 3) {
    const gridCells = [];
    const gCols = Math.max(2, Math.min(5, Math.round(W / 577)));
    const gRows = Math.max(2, Math.min(5, Math.round(H / 302)));
    for (let r = 0; r < gRows; r++) {
      for (let c = 0; c < gCols; c++) {
        const x = Math.round((c / gCols) * W) + 4;
        const y = Math.round((r / gRows) * H) + 4;
        const x2 = Math.round(((c + 1) / gCols) * W) - 4;
        const y2 = Math.round(((r + 1) / gRows) * H) - 4;
        const w = x2 - x; const h = y2 - y;
        if (w < 80 || h < 50) continue;
        const df = darkFraction(gray, W, H, x, y, w, h);
        if (df >= 0.012 && w / h >= 0.3 && w / h <= 4.5) {
          gridCells.push({ x, y, w, h, df });
        }
      }
    }
    if (gridCells.length > cells.length) {
      return gridCells.map(({ x, y, w, h }, i) => ({
        canvas: cropCanvas(canvas, x, y, w, h),
        index: i,
      }));
    }
  }

  return cells.map(({ x, y, w, h }, i) => ({
    canvas: cropCanvas(canvas, x, y, w, h),
    index: i,
  }));
}
