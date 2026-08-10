export function normalizeForMatch(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDuplicateOfExisting(newText, existingItems) {
  const newNorm = normalizeForMatch(newText);
  if (!newNorm) return true;

  for (const it of existingItems) {
    const exNorm = normalizeForMatch(it.text);
    if (!exNorm) continue;
    if (exNorm === newNorm) return true;

    if (exNorm.length >= 10 && newNorm.length >= 10) {
      if (exNorm.includes(newNorm) || newNorm.includes(exNorm)) return true;
    }

    const newWords = new Set(newNorm.split(" ").filter((w) => w.length > 3));
    const exWords = exNorm.split(" ").filter((w) => w.length > 3);
    if (newWords.size > 0 && exWords.length > 0) {
      const overlap = exWords.filter((w) => newWords.has(w)).length;
      const minWords = Math.min(newWords.size, exWords.length);
      if (minWords >= 2 && overlap >= minWords - 1) return true;
    }
  }

  return false;
}

export function filterDuplicates(newItems, existingItems) {
  const skipped = [];
  const unique = [];

  for (const item of newItems) {
    const dupTargets = [...existingItems, ...unique];
    if (isDuplicateOfExisting(item.text, dupTargets)) {
      skipped.push(item);
    } else {
      unique.push(item);
    }
  }

  return { unique, skipped };
}
