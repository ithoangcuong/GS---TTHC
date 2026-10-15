export function collectionDate(value) {
  if (!value.trim()) return null;
  const normalized = value.trim().replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    (_, day, month, year) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(Date.parse(normalized))
    || new Date(normalized).toISOString().slice(0, 10) !== normalized) throw new Error('Ngày nộp trong bộ lọc MOC không hợp lệ.');
  return normalized;
}

export function readMocCollectionContext(root, capturedAt) {
  const read = name => {
    const inputs = root.querySelectorAll(`input[formcontrolname="${name}"]`);
    if (inputs.length !== 1) throw new Error('Không nhận diện duy nhất bộ lọc Ngày nộp từ ngày/đến ngày MOC.');
    try { return collectionDate(inputs[0].value); }
    catch { throw new Error(`${name === 'advFilingFrom' ? 'Ngày nộp từ ngày' : 'Ngày nộp đến ngày'} không hợp lệ. Cần ngày/tháng/năm, ví dụ 14/7/2026.`); }
  };
  const submittedFrom = read('advFilingFrom'), submittedTo = read('advFilingTo');
  if (submittedFrom && submittedTo && submittedFrom > submittedTo) throw new Error('Ngày nộp từ ngày phải trước hoặc bằng đến ngày.');
  return { submittedFrom, submittedTo, capturedAt, scope: 'CURRENT_PAGE_ONLY', basis: 'VISIBLE_FILTERS' };
}
