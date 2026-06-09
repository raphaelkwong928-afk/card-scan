import { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  ScanLine,
  Upload,
  FileText,
  User,
  Briefcase,
  Mail,
  Phone,
  Globe,
  MapPin,
  Edit2,
  Check,
  X,
  Trash2,
  Download,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  CreditCard,
  Tag,
  Info,
  CheckCircle2,
  AlertCircle,
  File,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Tesseract from 'tesseract.js';
import * as XLSX from 'xlsx';
import { parseBusinessCard } from './utils/parseBusinessCard';
import { useExcelExport } from './hooks/useExcelExport';
import { extractPagesFromPDF } from './utils/pdfUtils';
import { imageUrlToCanvas, preprocessForOCR } from './utils/imagePreprocess';
import { detectAndSplitCards } from './utils/cardDetector';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toast, onDismiss }) {
  return (
    <div className={`toast ${toast.type}`}>
      <span className="toast-icon">
        {toast.type === 'success' && <CheckCircle2 size={16} />}
        {toast.type === 'error' && <AlertCircle size={16} />}
        {toast.type === 'info' && <Info size={16} />}
      </span>
      <span>{toast.message}</span>
    </div>
  );
}

// ─── Image Modal ──────────────────────────────────────────────────────────────
function ImageModal({ src, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <img className="modal-image" src={src} alt="Business card preview" onClick={e => e.stopPropagation()} />
    </div>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
function UploadZone({ onFiles }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'application/pdf': ['.pdf'],
    },
    maxSize: MAX_FILE_SIZE,
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        rejected.forEach(({ file, errors }) => {
          errors.forEach(err => {
            if (err.code === 'file-too-large') {
              // handled via toast
            }
          });
        });
      }
      onFiles(accepted);
    },
  });

  return (
    <div {...getRootProps()} className={`upload-zone ${isDragActive ? 'drag-over' : ''}`}>
      <input {...getInputProps()} />
      <div className="upload-zone-icon">
        <Upload size={26} />
      </div>
      <h3>{isDragActive ? 'Drop your cards here!' : 'Drop business cards here'}</h3>
      <p>or click to browse files</p>
      <div className="upload-zone-formats">
        {['JPG', 'PNG', 'WEBP', 'PDF'].map(f => (
          <span key={f} className="format-badge">{f}</span>
        ))}
        <span className="format-badge" style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>PDF = multi-page</span>
      </div>
    </div>
  );
}

// ─── Processing Card ───────────────────────────────────────────────────────────
function ProcessingCard({ card }) {
  const isDetecting = card.status === 'detecting';
  return (
    <div className="processing-card">
      <img className="processing-thumb" src={card.imageUrl} alt={card.filename} />
      <div className="processing-info">
        <div className="processing-filename">{card.filename}</div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${isDetecting ? 100 : card.progress}%` }} />
        </div>
        <div className="processing-status">
          {isDetecting ? (
            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
              🔍 Detecting cards in image…
            </span>
          ) : card.progress < 100 ? (
            `Scanning text… ${card.progress}%`
          ) : (
            'Finalizing…'
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Form ─────────────────────────────────────────────────────────────────
function EditForm({ card, onSave, onCancel }) {
  const [fields, setFields] = useState({ ...card.fields });

  const handleChange = (key, val) => {
    setFields(prev => ({ ...prev, [key]: val }));
  };

  const labels = [
    { key: 'name', label: 'Name', placeholder: 'Full name' },
    { key: 'title', label: 'Title', placeholder: 'Job title' },
    { key: 'company', label: 'Company', placeholder: 'Company name' },
    { key: 'email', label: 'Email', placeholder: 'email@example.com' },
    { key: 'phone', label: 'Phone', placeholder: '+1 234 567 8900' },
    { key: 'website', label: 'Website', placeholder: 'https://...' },
    { key: 'address', label: 'Address', placeholder: 'Street, City, Country' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional notes' },
  ];

  return (
    <div className="edit-form">
      {labels.map(({ key, label, placeholder }) => (
        <div key={key} className="edit-row">
          <span className="edit-label">{label}</span>
          <input
            className="edit-input"
            value={fields[key]}
            onChange={e => handleChange(key, e.target.value)}
            placeholder={placeholder}
          />
        </div>
      ))}
      <div className="edit-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onSave(fields)}>
          <Check size={14} /> Save
        </button>
      </div>
    </div>
  );
}

// ─── Extracted Card ───────────────────────────────────────────────────────────
function ExtractedCard({ card, onEdit, onRemove, onImageClick }) {
  const { fields, isEditing, imageUrl, filename } = card;

  const fieldRows = [
    { key: 'name', label: 'Name', icon: <User size={14} />, value: fields.name },
    { key: 'title', label: 'Title', icon: <Tag size={14} />, value: fields.title },
    { key: 'company', label: 'Company', icon: <Briefcase size={14} />, value: fields.company },
    { key: 'email', label: 'Email', icon: <Mail size={14} />, value: fields.email, isLink: true },
    { key: 'phone', label: 'Phone', icon: <Phone size={14} />, value: fields.phone },
    { key: 'website', label: 'Website', icon: <Globe size={14} />, value: fields.website, isLink: true },
    { key: 'address', label: 'Address', icon: <MapPin size={14} />, value: fields.address },
  ];

  if (isEditing) {
    return (
      <div className={`extracted-card editing`}>
        <div className="card-actions">
          <button className="btn-danger-ghost" onClick={onRemove} title="Remove card">
            <Trash2 size={14} />
          </button>
        </div>
        <div className="extracted-thumb-wrapper">
          <img className="extracted-thumb" src={imageUrl} alt={filename} />
        </div>
        <EditForm
          card={card}
          onSave={(fields) => onEdit(card.id, fields)}
          onCancel={() => onEdit(card.id, null)}
        />
      </div>
    );
  }

  return (
    <div className="extracted-card">
      <div className="card-actions">
        <button className="btn-icon" onClick={() => onEdit(card.id, null)} title="Edit">
          <Edit2 size={13} />
        </button>
        <button className="btn-danger-ghost" onClick={onRemove} title="Remove">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="extracted-thumb-wrapper">
        <img
          className="extracted-thumb"
          src={imageUrl}
          alt={filename}
          onClick={() => onImageClick(imageUrl)}
        />
      </div>
      <div className="extracted-body">
        {fieldRows.map(({ key, label, icon, value, isLink }) => (
          <div key={key} className="card-field">
            <span className="card-field-icon">{icon}</span>
            <span className="card-field-label">{label}</span>
            {isLink && value ? (
              <span className="card-field-value">
                <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer">
                  {value}
                </a>
              </span>
            ) : (
              <span className={`card-field-value ${!value ? 'empty' : ''}`}>
                {value || '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Results Table ────────────────────────────────────────────────────────────
function ResultsTable({ cards, isOpen, onToggle }) {
  const doneCards = cards.filter(c => c.status === 'done');
  const headers = ['Name', 'Job Title', 'Company', 'Email', 'Phone', 'Website', 'Address'];

  return (
    <div className="results-section">
      <div className="results-header">
        <span className="section-title" style={{ flex: 1, textTransform: 'none', fontSize: '13px', letterSpacing: 0 }}>
          Extracted Data Preview
          <span style={{ marginLeft: 8, fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>
            {doneCards.length} card{doneCards.length !== 1 ? 's' : ''}
          </span>
        </span>
        <button className="btn-icon" onClick={onToggle} style={{ marginLeft: 8 }}>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {isOpen && (
        <div className="results-table-wrapper">
          {doneCards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><FileText size={22} /></div>
              <h3>No data yet</h3>
              <p>Upload and scan some cards to see the extracted data here.</p>
            </div>
          ) : (
            <table className="results-table">
              <thead>
                <tr>
                  {headers.map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {doneCards.map(card => (
                  <tr key={card.id}>
                    <td>{card.fields.name || '—'}</td>
                    <td>{card.fields.title || '—'}</td>
                    <td>{card.fields.company || '—'}</td>
                    <td>
                      {card.fields.email ? (
                        <a href={`mailto:${card.fields.email}`}>{card.fields.email}</a>
                      ) : '—'}
                    </td>
                    <td>{card.fields.phone || '—'}</td>
                    <td>
                      {card.fields.website ? (
                        <a href={card.fields.website.startsWith('http') ? card.fields.website : `https://${card.fields.website}`} target="_blank" rel="noopener noreferrer">
                          {card.fields.website}
                        </a>
                      ) : '—'}
                    </td>
                    <td>{card.fields.address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [cards, setCards] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [tableOpen, setTableOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);
  const processingRef = useRef(false);
  const { exportToExcel } = useExcelExport();

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // ─── Multi-card detection before OCR ────────────────────────────────────────
  const expandToSubCards = useCallback(async (card) => {
    try {
      const subCards = await detectAndSplitCards(card.imageUrl);

      if (subCards.length > 1) {
        // Replace the single card with multiple sub-cards
        const subCardObjects = subCards.map((sub, i) => ({
          id: uuidv4(),
          file: card.file,
          filename: `${card.filename} — card ${i + 1}`,
          imageUrl: sub.canvas.toDataURL('image/jpeg', 0.92),
          status: 'pending',
          progress: 0,
          rawText: '',
          fields: { name: '', title: '', company: '', email: '', phone: '', website: '', address: '', notes: '' },
          isEditing: false,
          parentFilename: card.filename,
        }));

        // Remove placeholder, add real sub-cards
        setCards(prev => [
          ...prev.filter(c => c.id !== card.id),
          ...subCardObjects,
        ]);
        addToast(`Detected ${subCards.length} cards in ${card.filename} — scanning all!`, 'info');
        return subCardObjects;
      } else {
        // Single card — just return it for normal processing
        return [card];
      }
    } catch (err) {
      console.error('Card detection error:', err);
      return [card];
    }
  }, []);

  const handleFiles = useCallback(async (files) => {
    const imageFiles = [];
    const pdfFiles = [];

    for (const file of files) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(file);
      } else {
        imageFiles.push(file);
      }
    }

    // Regular images — create placeholder cards for multi-card detection
    const initialCards = [];
    for (const file of imageFiles) {
      initialCards.push({
        id: uuidv4(),
        file,
        filename: file.name,
        imageUrl: URL.createObjectURL(file),
        status: 'detecting',
        progress: 0,
        rawText: '',
        fields: { name: '', title: '', company: '', email: '', phone: '', website: '', address: '', notes: '' },
        isEditing: false,
      });
    }

    // PDFs — extract pages first, then treat as images
    for (const file of pdfFiles) {
      try {
        addToast(`Extracting pages from ${file.name}…`, 'info');
        const pages = await extractPagesFromPDF(file);
        for (const page of pages) {
          initialCards.push({
            id: uuidv4(),
            file,
            filename: page.filename,
            imageUrl: page.imageUrl,
            status: 'detecting',
            progress: 0,
            rawText: '',
            fields: { name: '', title: '', company: '', email: '', phone: '', website: '', address: '', notes: '' },
            isEditing: false,
          });
        }
        addToast(`${file.name} → ${pages.length} page${pages.length !== 1 ? 's' : ''} extracted`, 'success');
      } catch (err) {
        console.error('PDF error:', err);
        addToast(`Failed to process ${file.name}`, 'error');
      }
    }

    if (initialCards.length === 0) return;

    // Add placeholder cards to UI immediately
    setCards(prev => [...prev, ...initialCards]);

    // Process each page: detect multi-card, then OCR each sub-card
    for (const card of initialCards) {
      const subCards = await expandToSubCards(card);
      // Filter out any that were replaced by sub-cards (already added to state)
      const stillPresent = subCards.length === 1 && subCards[0].id === card.id;
      if (stillPresent) {
        await processCard(card);
      } else {
        // Sub-cards were added to state by expandToSubCards, now OCR them
        for (const sub of subCards) {
          await processCard(sub);
        }
      }
    }
  }, []);

  const processCard = useCallback(async (card) => {
    setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'processing', progress: 5 } : c));

    try {
      // Step 1: Load image and preprocess for better OCR
      const sourceCanvas = await imageUrlToCanvas(card.imageUrl);
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, progress: 15 } : c));

      const processedCanvas = preprocessForOCR(sourceCanvas);
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, progress: 25 } : c));

      // Step 2: Run OCR on the preprocessed canvas
      const result = await Tesseract.recognize(processedCanvas, 'eng+chi_sim', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setCards(prev => prev.map(c => c.id === card.id ? { ...c, progress: Math.round(m.progress * 65) + 25 } : c));
          }
        },
      });

      const rawText = result.data.text;
      const fields = parseBusinessCard(rawText);

      setCards(prev => prev.map(c => c.id === card.id ? {
        ...c,
        status: 'done',
        progress: 100,
        rawText,
        fields,
      } : c));

      addToast(`Scanned: ${fields.name || card.filename}`, 'success');
    } catch (err) {
      console.error('OCR error:', err);
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'done', progress: 100, fields: { name: '', title: '', company: '', email: '', phone: '', website: '', address: '', notes: '' } } : c));
      addToast(`Could not scan ${card.filename} — you can edit it manually.`, 'error');
    }
  }, []);

  const handleEditCard = useCallback((id, fields) => {
    if (fields === null) {
      // Toggle edit mode
      setCards(prev => prev.map(c => c.id === id ? { ...c, isEditing: !c.isEditing } : c));
    } else {
      // Save edits
      setCards(prev => prev.map(c => c.id === id ? { ...c, fields, isEditing: false } : c));
      addToast('Correction saved — model is learning! 🧠', 'success');
    }
  }, []);

  const handleRemoveCard = useCallback((id) => {
    setCards(prev => {
      const card = prev.find(c => c.id === id);
      if (card) URL.revokeObjectURL(card.imageUrl);
      return prev.filter(c => c.id !== id);
    });
  }, []);

  const handleDownload = useCallback(() => {
    const doneCards = cards.filter(c => c.status === 'done');
    if (doneCards.length === 0) return;

    const COLUMNS = [
      { key: 'name', header: 'Name' },
      { key: 'title', header: 'Job Title' },
      { key: 'company', header: 'Company' },
      { key: 'email', header: 'Email' },
      { key: 'phone', header: 'Phone' },
      { key: 'website', header: 'Website' },
      { key: 'address', header: 'Address' },
      { key: 'notes', header: 'Notes' },
    ];

    const data = doneCards.map(card => {
      const row = {};
      COLUMNS.forEach(({ key, header }) => {
        row[header] = card.fields[key] || '';
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS.map(c => c.header) });
    const colWidths = COLUMNS.map(({ key }) => {
      let maxLen = key.length + 2;
      data.forEach(row => {
        COLUMNS.forEach(({ key: k, header }) => {
          const val = row[header] || '';
          if (k === key && String(val).length > maxLen) {
            maxLen = Math.min(String(val).length + 2, 45);
          }
        });
      });
      return { wch: maxLen };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Business Cards');
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `business-cards-${date}.xlsx`);
    addToast(`Downloaded ${doneCards.length} cards to Excel!`, 'success');
  }, [cards, addToast]);

  const processingCards = cards.filter(c => c.status === 'processing' || c.status === 'pending' || c.status === 'detecting');
  const doneCards = cards.filter(c => c.status === 'done');
  const totalDone = doneCards.length;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <CreditCard />
        </div>
        <div className="app-header-text">
          <h1>CardScan</h1>
          <p>Scan business cards · Extract contacts · Export to Excel</p>
        </div>
      </header>

      {/* Main */}
      <main className="app-main">
        {/* Upload */}
        <UploadZone onFiles={handleFiles} />

        {/* Processing */}
        {processingCards.length > 0 && (
          <div>
            <div className="section-title" style={{ marginBottom: 12 }}>
              <ScanLine size={14} /> Processing
            </div>
            <div className="cards-grid">
              {processingCards.map(card => (
                <ProcessingCard key={card.id} card={card} />
              ))}
            </div>
          </div>
        )}

        {/* Extracted Cards */}
        {doneCards.length > 0 && (
          <div>
            <div className="section-title" style={{ marginBottom: 12 }}>
              <CheckCircle2 size={14} /> Extracted Cards
            </div>
            <div className="cards-grid">
              {doneCards.map((card, i) => (
                <div key={card.id} style={{ animationDelay: `${i * 60}ms` }}>
                  <ExtractedCard
                    card={card}
                    onEdit={handleEditCard}
                    onRemove={() => handleRemoveCard(card.id)}
                    onImageClick={setPreviewImage}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results Table */}
        {cards.length > 0 && (
          <ResultsTable cards={cards} isOpen={tableOpen} onToggle={() => setTableOpen(v => !v)} />
        )}
      </main>

      {/* Action Bar */}
      <div className={`action-bar ${totalDone === 0 ? 'hidden' : ''}`}>
        <span className="action-bar-info">
          <strong>{totalDone}</strong> card{totalDone !== 1 ? 's' : ''} ready to export
        </span>
        <button className="btn-download" onClick={handleDownload} disabled={totalDone === 0}>
          <Download size={16} />
          Download Excel
        </button>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </div>

      {/* Image Preview */}
      {previewImage && (
        <ImageModal src={previewImage} onClose={() => setPreviewImage(null)} />
      )}
    </div>
  );
}
