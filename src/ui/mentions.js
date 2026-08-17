function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function mentionTokens(text) {
  return [...String(text || '').matchAll(/(?:^|\s)@([^\s@]+)/g)].map((match) => match[1]);
}

export function resolveMentionRecipients(text, roster, selected = []) {
  const recipients = [...selected];
  const unknown = [];
  for (const token of mentionTokens(text)) {
    const wanted = normalized(token);
    const row = roster.find((candidate) => (
      normalized(candidate.id) === wanted || normalized(candidate.name) === wanted
    ));
    if (!row) {
      unknown.push(token);
      continue;
    }
    if (!recipients.some((candidate) => candidate.id === row.id)) recipients.push(row);
  }
  return { recipients, unknown };
}
