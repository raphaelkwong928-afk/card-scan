/**
 * Improved business card parser — multi-pass with position heuristics.
 *
 * Pass 1: Extract unambiguous fields (email, phone, URL, fax)
 * Pass 2: Extract structured fields using position + context
 * Pass 3: Assign remaining lines to Name / Title / Company / Address
 */

const EMAIL_REGEX = /(?:[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/;
const PHONE_REGEX = /(?:(?:\+?\d{1,3}[-.\s]?)?\(?\d{1,5}\)?[-.\s]?\d{1,5}[-.\s]?\d{1,9})/g;
const URL_REGEX = /(?:(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/\S*)?)/gi;
const FAX_REGEX = /(?:F(?:\s?|[-.:])?(?:ax)?[:\s]*)([\d\s\-+().]{7,20})/i;

// Common title keywords — these are strong signals, not just substrings
const TITLE_KEYWORDS = [
  '\bCEO\b', '\bCTO\b', '\bCFO\b', '\bCOO\b', '\bCMO\b', '\bCIO\b', '\bCISO\b',
  '\bCOO\b', '\bPresident\b', '\bVice President\b', '\bVP\b',
  '\bDirector\b', '\bManagers?\b', '\bSupervisor\b',
  '\bEngineer\b', '\bDeveloper\b', '\bDesigner\b', '\bAnalyst\b',
  '\bConsultant\b', '\bAdvisor\b', '\bCoordinator\b',
  '\bExecutive\b', '\bHead of\b', '\bChief\b', '\bLead\b', '\bSenior\b',
  '\bFounder\b', '\bPartner\b', '\bAssociate\b',
  '\bSales\b', '\bMarketing\b', '\bHR\b', '\bHuman Resources\b',
  '\bGeneral Manager\b', '\bGM\b',
  '\bOperations\b', '\bProduct\b', '\bProject\b',
  '\bBD\b', '\bBusiness Development\b',
];

// Company suffixes — strong signal for company field
const COMPANY_SUFFIXES = [
  /\b(Inc|Inc\.|LLC|Ltd|Ltd\.|Corp|Corp\.|Co\.|Co\b)\b/i,
  /\b(Group|Holdings|Partners|Associates)\b/i,
  /\b(Solutions|Services|Consulting|Technologies|Tech)\b/i,
  /\b(Company|Enterprises|International|Global|Systems)\b/i,
  /\b(Pte|Ltd|Sdn|Bhd|GmbH|SARL|AG)\b/i,
];

// Patterns that are likely NOT a title (probably company or address)
const NOT_TITLE_PATTERNS = [
  /^[A-Z][a-z]+\s+(Ltd|LLC|Inc|Corp|Group|Solutions|Tech|Consulting)/,
  /^\d+\s+/,                          // starts with number (address)
  /^\+?\d{3,}/,                       // starts with phone digits
  /@/,                                // email
  /www\.|http/,                       // URL
];

// Patterns likely NOT a company
const NOT_COMPANY_PATTERNS = [
  /^[a-z]/,                           // starts with lowercase
  /@/,                                // email
  /www\.|http/,
  /^\+?\d{3,}/,
  /^[A-Z][a-z]+\s[A-Z][a-z]+$/,      // looks like a name (Firstname Lastname)
];

// Patterns likely NOT a name
const NOT_NAME_PATTERNS = [
  /@|www\.|http|\+\d{3,}|^\d+\s|Inc|LLC|Corp|Group|Solutions/,
  /[a-z][.][a-z]/i,                  // abbr. like u.s. (probably address)
];

function isLikelyPhone(str) {
  const digits = str.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 20;
}

function isLikelyAddress(line) {
  return /(#|Suite|Ste\.|Floor|Fl\.|Bldg|Tower|Rd|St\.|Ave\.|Blvd|Drive|Dr\.|Lane|Ln|Place|Pl|Road|Avenue|Boulevard|Way)|[\d]{3,}[A-Z]/.test(line) ||
    /路|街|号|层|楼|室|栋|座|单元/.test(line);
}

function scoreTitle(line) {
  let score = 0;
  const lower = line.toLowerCase();
  for (const kw of TITLE_KEYWORDS) {
    if (new RegExp(kw, 'i').test(line)) score += 2;
  }
  // Penalize lines that look like company/address
  for (const p of NOT_TITLE_PATTERNS) { if (p.test(line)) score -= 3; }
  // Short lines (1-4 words) are more likely titles
  const words = line.trim().split(/\s+/);
  if (words.length >= 1 && words.length <= 6) score += 1;
  // ALL CAPS long lines are less likely titles
  if (line === line.toUpperCase() && line.length > 20) score -= 2;
  return score;
}

function scoreCompany(line) {
  let score = 0;
  for (const suffix of COMPANY_SUFFIXES) {
    if (suffix.test(line)) score += 3;
  }
  for (const p of NOT_COMPANY_PATTERNS) { if (p.test(line)) score -= 3; }
  // Company names are often 2-5 words, capitalized
  const words = line.trim().split(/\s+/);
  if (words.length >= 1 && words.length <= 6) score += 1;
  return score;
}

function scoreName(line) {
  let score = 0;
  const trimmed = line.trim();
  // Names: typically 2-4 words, each capitalized
  const words = trimmed.split(/\s+/);
  if (words.length >= 1 && words.length <= 5) {
    const isCapitalized = words.every(w => /^[A-Z][a-zA-Z''-]+$/.test(w));
    if (isCapitalized) score += 3;
    // ALL CAPS single word is likely an abbreviation (not a name)
    if (trimmed === trimmed.toUpperCase() && words.length === 1) score -= 2;
  }
  for (const p of NOT_NAME_PATTERNS) { if (p.test(trimmed)) score -= 3; }
  return score;
}

// ─── Main parser ───────────────────────────────────────────────────────────────
export function parseBusinessCard(rawText) {
  if (!rawText || !rawText.trim()) {
    return emptyFields();
  }

  // Clean: collapse multiple spaces, normalize unicode quotes, remove control chars
  let text = rawText
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E\u00A0-\u024F\u4E00-\u9FFF\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(l => l && l.length > 1);

  // ─── PASS 1: Unambiguous fields ────────────────────────────────────────────
  const email = (text.match(EMAIL_REGEX) || [])[0] || '';

  const phones = [];
  let phoneMatch;
  const phoneRegex = new RegExp(PHONE_REGEX.source, 'g');
  while ((phoneMatch = phoneRegex.exec(text)) !== null) {
    const candidate = phoneMatch[0].trim();
    if (isLikelyPhone(candidate) && !candidate.match(URL_REGEX)) {
      phones.push(candidate.replace(/\s+/g, ' '));
    }
  }
  // Deduplicate
  const deduped = [];
  for (const p of phones) {
    const digits = p.replace(/\D/g, '');
    if (!deduped.some(d => d.replace(/\D/g, '').includes(digits) || digits.includes(d.replace(/\D/g, '')))) {
      deduped.push(p);
    }
  }
  const phone = deduped.join(' / ');

  const urls = (text.match(URL_REGEX) || []).filter(u => !u.includes('@'));
  const url = urls[0] || '';

  // ─── PASS 2: Score each line for each role ───────────────────────────────────
  const scored = lines.map((line, idx) => {
    // Skip lines already captured in pass 1
    if (email && line.includes(email)) return null;
    if (url && line.toLowerCase().includes(url.toLowerCase())) return null;
    // Remove phone digits from comparison string to avoid false matches
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length > 5 && line.replace(/\D/g, '').includes(phoneDigits.slice(0, 6))) return null;

    const scores = {
      name: scoreName(line),
      title: scoreTitle(line),
      company: scoreCompany(line),
      address: isLikelyAddress(line) ? 2 : 0,
      notes: 0,
      line,
      idx,
    };
    return scores;
  }).filter(Boolean);

  // ─── PASS 3: Greedy best-assignment ─────────────────────────────────────────
  const assigned = {};
  const usedIndices = new Set();

  // Assign in priority order: address, title, company, name
  const roleOrder = ['address', 'title', 'company', 'name'];

  for (const role of roleOrder) {
    let best = null;
    let bestScore = role === 'address' ? 0 : -999;

    for (const s of scored) {
      if (usedIndices.has(s.idx)) continue;
      const sc = s[role];
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }

    if (best && bestScore > 0) {
      assigned[role] = best.line;
      usedIndices.add(best.idx);
    }
  }

  // Collect remaining lines as notes
  const unused = scored
    .filter(s => !usedIndices.has(s.idx) && s.scores?.notes !== undefined || !assigned.name)
    .map(s => s.line)
    .slice(0, 5);
  const notes = unused.join(' | ');

  return {
    name: assigned.name || '',
    title: assigned.title || '',
    company: assigned.company || '',
    email,
    phone,
    website: url,
    address: assigned.address || '',
    notes,
  };
}

function emptyFields() {
  return { name: '', title: '', company: '', email: '', phone: '', website: '', address: '', notes: '' };
}
