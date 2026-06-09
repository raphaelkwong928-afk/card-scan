import { useState, useRef, useCallback } from 'react';
import Tesseract from 'tesseract.js';

export function useOCR() {
  const [progress, setProgress] = useState(0);
  const workerRef = useRef(null);

  const recognize = useCallback(async (file) => {
    return new Promise((resolve, reject) => {
      Tesseract.recognize(file, 'eng+chi_sim', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      })
        .then(({ data: { text } }) => {
          setProgress(100);
          resolve(text);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }, []);

  return { recognize, progress };
}
