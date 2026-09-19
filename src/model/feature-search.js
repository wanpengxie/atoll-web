function searchableText(row) {
  return [
    row?.title,
    row?.subtitle,
    row?.channelName,
    row?.channelId,
    row?.text,
    row?.name,
    row?.actorId,
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

function queryTerms(query) {
  return String(query || '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

export function searchFeatureIndex(index = [], query = '', limit = 40) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  return index
    .flatMap((row, position) => {
      const haystack = searchableText(row);
      if (!terms.every((term) => haystack.includes(term))) return [];
      const title = String(row?.title || row?.name || '未命名结果').toLocaleLowerCase();
      const score = terms.reduce((total, term) => total
        + (title === term ? 8 : title.startsWith(term) ? 4 : title.includes(term) ? 2 : 1), 0);
      return [{ row, position, score }];
    })
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, Math.max(0, limit))
    .map(({ row }) => row);
}
