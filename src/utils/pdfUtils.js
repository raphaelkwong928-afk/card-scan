import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker — must be done before any PDF operations
// Using jsDelivr CDN with the exact installed version (6.x)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Render a single PDF page to a JPEG data URL using a canvas.
 * scale: higher = better quality, slower. 2.5 is a good balance for OCR.
 */
async function renderPageToDataURL(page, scale = 2.5) {
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  // White background — critical for OCR quality
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
  }).promise;

  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Extract all pages from a PDF file as individual JPEG data URLs.
 * Returns an array of { pageNumber, imageUrl, filename } objects.
 */
export async function extractPagesFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // Disable evaluation to avoid CSP issues in some deployments
    isEvalSupported: false,
    // Prefer system fonts for better rendering
    useSystemFonts: true,
  }).promise;

  const baseName = file.name.replace(/\.pdf$/i, '');
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const imageUrl = await renderPageToDataURL(page);

    pages.push({
      pageNumber: i,
      imageUrl,
      filename: pdf.numPages > 1 ? `${baseName} — page ${i}` : baseName,
    });
  }

  return pages;
}
