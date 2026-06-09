# Business Card Scanner — SPEC.md

## 1. Concept & Vision

A sleek, professional web app that lets users upload multiple business card images at once, uses OCR to extract contact details (name, company, title, phone, email, address, website), and exports everything to a clean Excel spreadsheet. The vibe is **modern productivity tool** — think Linear meets Notion. Fast, frictionless, visually satisfying. Cards get "processed" with a satisfying animation, results appear in a live preview table, and the download button feels like a reward.

---

## 2. Design Language

**Aesthetic:** Clean SaaS tool — light background, generous whitespace, subtle depth through shadows and borders. Feels premium without being flashy.

**Color Palette:**
- Background: `#F8FAFC` (slate-50)
- Surface: `#FFFFFF`
- Primary: `#4F46E5` (indigo-600)
- Primary hover: `#4338CA`
- Accent: `#10B981` (emerald — success/extracted state)
- Warning: `#F59E0B`
- Text primary: `#0F172A` (slate-900)
- Text secondary: `#64748B` (slate-500)
- Border: `#E2E8F0` (slate-200)
- Card extracted bg: `#F0FDF4` (green-50)

**Typography:**
- Font: `Plus Jakarta Sans` (Google Fonts) — clean, modern, slightly distinctive
- Headings: 600-700 weight
- Body: 400-500 weight

**Spatial System:** 8px base grid. Cards: 16px padding. Sections: 32-48px gap.

**Motion Philosophy:**
- Upload zone: subtle pulse animation on drag-over
- Card processing: spinner + progress indicator
- Extracted cards: slide-in from bottom with fade (staggered)
- Success toast: slide in from top-right, auto-dismiss 3s
- Download button: press effect (scale 0.97) on click

**Visual Assets:**
- Icons: Lucide React (consistent stroke weight)
- Upload zone: dashed border, icon + text
- Business card previews: rounded corners, shadow, subtle border

---

## 3. Layout & Structure

```
┌─────────────────────────────────────────────┐
│  Header: Logo + Title + Subtitle             │
├─────────────────────────────────────────────┤
│  Upload Zone (drag & drop + click)          │
│  - supports multiple files                   │
│  - shows accepted formats: jpg, png, webp    │
├─────────────────────────────────────────────┤
│  Processing Queue (if any)                   │
│  - shows cards being OCR'd with progress     │
├─────────────────────────────────────────────┤
│  Extracted Cards Grid                        │
│  - each card shows preview + parsed fields   │
│  - edit button per card                      │
│  - remove button per card                    │
├─────────────────────────────────────────────┤
│  Results Table (collapsible)                 │
│  - live preview of Excel data                │
├─────────────────────────────────────────────┤
│  Action Bar (sticky bottom on mobile)       │
│  - Card count + "Download Excel" button      │
└─────────────────────────────────────────────┘
```

**Responsive:** Single column on mobile, 2-column card grid on tablet, full layout on desktop.

---

## 4. Features & Interactions

### Upload
- Drag & drop multiple images onto the zone
- Click to open file picker (multiple selection)
- Accepts: JPG, PNG, WEBP, PDF (first page only)
- Max file size: 10MB per file
- On drop: immediate visual feedback (border turns primary color, background tints)

### OCR Processing
- Uses Tesseract.js for in-browser OCR (no server needed)
- Progress bar per card (0-100%)
- Extracted text is parsed into structured fields:
  - Full Name
  - Job Title
  - Company Name
  - Email
  - Phone Number(s)
  - Website/URL
  - Address
  - Any other notes
- Smart regex + heuristics for field extraction

### Card Preview & Edit
- Thumbnail of uploaded image on left
- Parsed fields displayed on right
- "Edit" button opens inline edit mode — user can correct OCR mistakes
- "Remove" button (×) removes card from queue
- Cards can be reordered via drag (stretch goal)

### Results Table
- Live preview table below the cards
- Columns: Name, Title, Company, Email, Phone, Website, Address
- Shows all extracted (and edited) data
- Scrollable if many cards

### Excel Export
- Downloads `.xlsx` file using SheetJS (client-side)
- Filename: `business-cards-YYYY-MM-DD.xlsx`
- Sheet name: "Business Cards"
- Headers in bold
- Auto-column-width
- If no data, button is disabled with tooltip "Upload cards first"

### Error Handling
- File type error: toast "Only JPG, PNG, WEBP, and PDF files are supported"
- OCR failure: card shows "Could not extract text — click to edit manually"
- Empty result: card shows empty fields, user can fill manually

---

## 5. Component Inventory

### UploadZone
- Default: dashed border `#E2E8F0`, icon + "Drop business cards here" text
- Drag-over: border `#4F46E5`, background `#EEF2FF`, scale(1.01)
- Has click handler and hidden file input

### ProcessingCard
- Shows thumbnail + filename + progress bar
- Progress bar: indigo fill, animated width transition
- On complete: checkmark icon replaces spinner

### ExtractedCard
- White card, shadow-sm, rounded-xl
- Image thumbnail (80px wide, object-cover)
- Fields list: label (text-secondary, small) + value (text-primary, medium)
- Edit mode: fields become input fields
- Remove button: top-right, opacity-0 on hover-reveal
- Extracted state: left border 3px emerald

### ResultsTable
- HTML table, styled to match design system
- Sticky header row
- Alternating row backgrounds
- Scrollable container (max-height: 400px)

### DownloadButton
- Primary button style
- Shows card count: "Download Excel (12 cards)"
- Loading state during export
- Disabled state when no cards

### Toast
- Fixed position top-right
- Success (green), Error (red), Info (blue)
- Auto-dismiss with progress bar

---

## 6. Technical Approach

**Stack:** React + Vite (single-page app, client-side only)

**Key Libraries:**
- `tesseract.js` — OCR engine (runs entirely in browser via WebAssembly)
- `xlsx` (SheetJS) — Excel file generation
- `lucide-react` — icons
- `react-dropzone` — file upload handling

**Architecture:**
- `App.jsx` — main state management (cards array, processing state)
- `UploadZone.jsx` — file drop area
- `ProcessingCard.jsx` — in-progress OCR card
- `ExtractedCard.jsx` — completed card with editable fields
- `ResultsTable.jsx` — live preview table
- `useOCR.js` — custom hook wrapping Tesseract.js
- `useExcelExport.js` — custom hook for SheetJS export
- `parseBusinessCard.js` — regex/heuristic text parser

**Data Model:**
```js
Card {
  id: string (uuid)
  file: File
  imageUrl: string (local blob URL)
  status: 'pending' | 'processing' | 'done' | 'error'
  progress: number (0-100)
  rawText: string
  fields: {
    name: string
    title: string
    company: string
    email: string
    phone: string
    website: string
    address: string
    notes: string
  }
  isEditing: boolean
}
```

**Field Extraction Heuristics:**
- Email: regex for standard email pattern
- Phone: regex for phone patterns (international, US, CN formats)
- URL: regex for http(s):// and common domain patterns
- Name: heuristic — first capitalized words at top of card
- Title: common title keywords (CEO, Manager, Director, Engineer, etc.)
- Company: line with common company suffixes (Inc, Ltd, LLC, Co., 公司)
- Address: multi-line, contains numbers + street names
