/**
 * Detect and split multiple business cards within a single image.
 *
 * Robust multi-pass approach:
 * 1. Analyze dark pixel density per column/row to find content bands
 * 2. Use horizontal/vertical "density bands" to find true card boundaries
 * 3. Grid fallback with dark-pixel validation
 * 4. Merge vertically-split card halves using aspect ratio
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
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

// ─── Image analysis ─────────────────────────────────────────────────────────────
function imageToGrayscale(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] =
      0.299 * imgData.data[i * 4] +
      0.587 * imgData.data[i * 4 + 1] +
      0.114 * imgData.data[i * 4 + 2];
  }
  return { gray, width, height };
}

/** Compute vertical dark-pixel density per column (how "content-heavy" each column is) */
function columnDensity(gray, width, height) {
  const density = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) {
      if (gray[y * width + x] < 140) dark++;
    }
    density[x] = dark / height;
  }
  return density;
}

/** Compute horizontal dark-pixel density per row */
function rowDensity(gray, width, height) {
  const density = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[base + x] < 140) dark++;
    }
    density[y] = dark / width;
  }
  return density;
}

/** Gaussian smooth a 1D array */
function smooth(arr, radius = 6) {
  const n = arr.length;
  const sigma = radius / 2.0;
  const kSize = radius * 2 + 1;
  const kernel = new Float32Array(kSize);
  let kSum = 0;
  for (let k = 0; k < kSize; k++) {
    const d = k - radius;
    kernel[k] = Math.exp(-(d * d) / (2 * sigma * sigma));
    kSum += kernel[k];
  }
  for (let k = 0; k < kSize; k++) kernel[k] /= kSum;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < kSize; k++) {
      const idx = Math.max(0, Math.min(n - 1, i - radius + k));
      v += arr[idx] * kernel[k];
    }
    out[i] = v;
  }
  return out;
}

/** Dark pixel fraction in a rectangular region */
function darkFraction(gray, width, height, x, y, w, h) {
  const x2 = Math.min(width, Math.round(x + w));
  const y2 = Math.min(height, Math.round(y + h));
  const x1 = Math.max(0, Math.round(x));
  const y1 = Math.max(0, Math.round(y));
  const tw = x2 - x1;
  const th = y2 - y1;
  const total = tw * th;
  if (total <= 0) return 0;
  let dark = 0;
  for (let row = y1; row < y2; row++) {
    const base = row * width;
    for (let col = x1; col < x2; col++) {
      if (gray[base + col] < 140) dark++;
    }
  }
  return dark / total;
}

/**
 * Find the dominant spacing between content bands.
 * e.g., for 3 columns, find the ~1/3 and ~2/3 positions of content.
 * Uses density bands: find where density transitions from high→low or low→high.
 */
function findContentBands(density, nBands, isVertical = true) {
  const n = density.length;
  const smoothed = smooth(density, 8);
  const max = smoothed.reduce((a, b) => (a > b ? a : b));
  const min = smoothed.reduce((a, b) => (a < b ? a : b));
  const range = max - min;

  if (range < 0.001) return []; // uniform

  // Find all transition points (high→low or low→high)
  const transitions = [];
  const threshold = min + range * 0.3; // below this = "gap"

  for (let i = 5; i < n - 5; i++) {
    const prev = smoothed[i - 1];
    const curr = smoothed[i];
    const next = smoothed[i + 1];
    // A transition point: crossing the threshold
    if ((prev >= threshold && curr < threshold) || (prev < threshold && curr >= threshold)) {
      transitions.push(i);
    }
  }

  // Remove transitions that are too close together
  const minGap = Math.round(n / (nBands * 3)); // minimum gap between transitions
  const filtered = [];
  for (const t of transitions) {
    if (filtered.length === 0 || t - filtered[filtered.length - 1] >= minGap) {
      filtered.push(t);
    }
  }

  // We need nBands-1 cuts. Take the transitions closest to the expected positions.
  if (filtered.length < nBands - 1) {
    // Not enough transitions — use evenly-spaced cuts
    const cuts = [];
    for (let i = 1; i < nBands; i++) {
      cuts.push(Math.round((i / nBands) * n));
    }
    return cuts;
  }

  // Select nBands-1 transitions that divide the image most evenly
  const expectedSpacing = n / nBands;
  const scored = filtered.map(pos => ({
    pos,
    score: Math.abs((pos / n) * nBands - Math.round((pos / n) * nBands)),
  }));
  scored.sort((a, b) => a.score - b.score);
  const selected = scored.slice(0, nBands - 1).map(s => s.pos).sort((a, b) => a - b);

  return selected;
}

/**
 * Robust card detector using density-band analysis.
 */
function detectCardsByDensity(gray, width, height) {
  const colDensity = smooth(columnDensity(gray, width, height), 8);
  const rowDensity2 = smooth(rowDensity(gray, width, height), 8);

  // Determine grid: try 3 cols × 4 rows (most common for business card scans)
  const candidates = [
    { cols: 3, rows: 4 },
    { cols: 4, rows: 3 },
    { cols: 3, rows: 3 },
    { cols: 2, rows: 2 },
    { cols: 4, rows: 4 },
    { cols: 3, rows: 2 },
    { cols: 4, rows: 2 },
    { cols: 5, rows: 3 },
  ];

  let bestGrid = null;
  let bestScore = -Infinity;

  for (const { cols, rows } of candidates) {
    const cuts = { v: [], h: [] };

    // Find vertical cuts using density band analysis
    cuts.v = findContentBands(colDensity, cols, true);
    cuts.h = findContentBands(rowDensity2, rows, false);

    // Partition into cells
    const vBounds = [0, ...cuts.v, width].sort((a, b) => a - b);
    const hBounds = [0, ...cuts.h, height].sort((a, b) => a - b);

    let validCount = 0;
    const cells = [];

    for (let vi = 0; vi < vBounds.length - 1; vi++) {
      for (let hi = 0; hi < hBounds.length - 1; hi++) {
        const x = vBounds[vi] + 4;
        const y = hBounds[hi] + 4;
        const x2 = vBounds[vi + 1] - 4;
        const y2 = hBounds[hi + 1] - 4;
        const w = x2 - x;
        const h = y2 - y;
        const df = darkFraction(gray, width, height, x, y, w, h);
        const aspect = w / (h || 1);

        if (df >= 0.015 && aspect >= 0.4 && aspect <= 3.5) {
          validCount++;
          cells.push({ x, y, w, h, df });
        }
      }
    }

    // Score: maximize valid cells, slight penalty for excess cells
    const totalCells = cols * rows;
    const score = validCount * 10 - Math.abs(validCount - 11) * 2;

    if (score > bestScore) {
      bestScore = score;
      bestGrid = { cols, rows, cuts, cells };
    }
  }

  if (!bestGrid) return [];

  const { cols, rows, cells } = bestGrid;

  // Merge vertically-adjacent cells in same column if they form a single card
  // Group by column
  const colCells = {};
  for (const cell of cells) {
    const col = Math.round(cell.x / width * cols);
    if (!colCells[col]) colCells[col] = [];
    colCells[col].push(cell);
  }

  const mergedCells = [];
  const used = new Set();

  for (const col in colCells) {
    const colList = colCells[col].sort((a, b) => a.y - b.y);
    let i = 0;
    while (i < colList.length) {
      const first = colList[i];
      let merged = { ...first };
      let j = i + 1;

      // Merge adjacent cells (vertically split cards)
      while (j < colList.length) {
        const next = colList[j];
        const gap = next.y - merged.y - merged.h;
        const proposedH = next.y + next.h - merged.y;
        const proposedAspect = merged.w / proposedH;

        if (gap < 40 && proposedAspect >= 0.4 && proposedAspect <= 3.0) {
          // Merge: extend height
          merged = {
            x: merged.x,
            y: merged.y,
            w: merged.w,
            h: proposedH,
            df: (merged.df * merged.h + next.df * next.h) / proposedH,
          };
          used.add(colList[j]);
          j++;
        } else {
          break;
        }
      }
      used.add(colList[i]);
      mergedCells.push(merged);
      i = j;
    }
  }

  // Deduplicate by center position
  const seen = new Set();
  const finalCells = [];
  for (const cell of mergedCells) {
    const cx = Math.round(cell.x / 40) * 40;
    const cy = Math.round(cell.y / 40) * 40;
    const key = `${cx},${cy}`;
    if (!seen.has(key)) {
      seen.add(key);
      finalCells.push(cell);
    }
  }

  return finalCells;
}

/**
 * Simple grid fallback: try multiple grids and pick the best by valid cell count.
 */
function gridFallback(gray, width, height) {
  const candidates = [
    { cols: 3, rows: 4 },
    { cols: 4, rows: 3 },
    { cols: 3, rows: 3 },
    { cols: 4, rows: 4 },
    { cols: 2, rows: 2 },
    { cols: 3, rows: 2 },
    { cols: 4, rows: 2 },
    { cols: 5, rows: 3 },
  ];

  let best = { cols: 3, rows: 4, score: -Infinity, cells: [] };

  for (const { cols, rows } of candidates) {
    const cells = [];
    let valid = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.round((c / cols) * width) + 4;
        const y = Math.round((r / rows) * height) + 4;
        const x2 = Math.round(((c + 1) / cols) * width) - 4;
        const y2 = Math.round(((r + 1) / rows) * height) - 4;
        const w = x2 - x;
        const h = y2 - y;
        const df = darkFraction(gray, width, height, x, y, w, h);
        const aspect = w / (h || 1);

        if (df >= 0.015 && aspect >= 0.4 && aspect <= 3.5) {
          valid++;
          cells.push({ x, y, w, h, df });
        }
      }
    }

    // Score: prefer ~11 valid cells, penalize excess
    const score = valid * 10 - Math.abs(valid - 11) * 2;
    if (score > best.score) {
      best = { cols, rows, score, cells };
    }
  }

  return best.cells;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function detectAndSplitCards(imageUrl) {
  const canvas = await loadImageToCanvas(imageUrl);
  const { gray, width, height } = imageToGrayscale(canvas);

  // Primary: density-band based detection
  let cells = detectCardsByDensity(gray, width, height);

  // Fallback to grid if detection is too sparse
  if (cells.length < 2) {
    cells = gridFallback(gray, width, height);
  }

  // Final fallback: whole image as one card
  if (!cells || cells.length === 0) {
    return [{ canvas: cropCanvas(canvas, 4, 4, width - 8, height - 8), index: 0 }];
  }

  return cells.map(({ x, y, w, h }, i) => ({
    canvas: cropCanvas(canvas, x, y, w, h),
    index: i,
  }));
}
