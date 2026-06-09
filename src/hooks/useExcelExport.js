import { useCallback } from 'react';
import * as XLSX from 'xlsx';

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

export function useExcelExport() {
  const exportToExcel = useCallback((cards) => {
    if (!cards || cards.length === 0) return;

    const data = cards
      .filter(c => c.status === 'done')
      .map(card => {
        const row = {};
        COLUMNS.forEach(({ key, header }) => {
          row[header] = card.fields[key] || '';
        });
        return row;
      });

    if (data.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS.map(c => c.header) });

    // Auto-width columns
    const colWidths = COLUMNS.map(({ key }) => {
      let maxLen = key.length + 2;
      data.forEach(row => {
        const val = row[COLUMNS.find(c => c.key === key).header] || '';
        if (String(val).length > maxLen) maxLen = Math.min(String(val).length + 2, 40);
      });
      return { wch: maxLen };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Business Cards');

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `business-cards-${date}.xlsx`);
  }, []);

  return { exportToExcel };
}
