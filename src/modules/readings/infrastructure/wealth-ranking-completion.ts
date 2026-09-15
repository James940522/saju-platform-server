// Accept transport-only wrappers, never guess missing fields or extract a JSON
// fragment from prose. Domain schema and evidence validation still run afterward.
export function wealthCompletionFormat(text: string) {
  const value = text.trim();
  if (!value) return 'empty';
  if (value.startsWith('```')) return 'code_fence';
  if (value.startsWith('{')) return 'json_object';
  if (value.startsWith('"')) return 'json_string';
  return 'other_text';
}

export function parseWealthRankingCompletion(text: string): unknown {
  let value = text.trim();
  if (value.startsWith('```')) {
    const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/iu.exec(value);
    if (!fenced?.[1]) throw new SyntaxError('Invalid completion wrapper');
    value = fenced[1].trim();
  }
  const parsed: unknown = JSON.parse(value);
  // Some compatible endpoints serialize a JSON object as a JSON string again.
  // Decode at most once more; recursive/partial repair is intentionally excluded.
  return typeof parsed === 'string' ? JSON.parse(parsed.trim()) : parsed;
}
