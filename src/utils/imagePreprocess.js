/**
 * Preprocess a canvas context to improve OCR accuracy.
 * Steps: grayscale → contrast boost → slight unsharp mask → cleanup.
 */
export function preprocessForOCR(sourceCanvas) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;

  // Draw original
  ctx.drawImage(sourceCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // Convert to grayscale + contrast boost in one pass
  const contrast = 1.4;   // > 1 = stronger contrast
  const brightness = 5;   // positive = brighter
  const offset = 128 + brightness;

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Contrast + brightness
    let out = ((gray - offset) * contrast) + offset;
    out = Math.max(0, Math.min(255, out));

    // Adaptive thresholding: push toward white or black
    out = out > 128 ? Math.min(255, out * 1.1) : out * 0.85;
    out = Math.round(Math.max(0, Math.min(255, out)));

    data[i]     = out; // R
    data[i + 1] = out; // G
    data[i + 2] = out; // B
    // Alpha unchanged
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Load an image URL into a canvas, ready for preprocessing.
 */
export function imageUrlToCanvas(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Scale up small images for better OCR
      const scale = img.width < 800 ? 2 : 1;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false; // keep edges sharp
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}
