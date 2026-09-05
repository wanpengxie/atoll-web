function markRange(mask, start, end) {
  mask.fill(1, start, end);
}

function markFencedAndIndentedCode(source, mask) {
  let offset = 0;
  let fence = null;
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    const end = newline === -1 ? source.length : newline + 1;
    const line = source.slice(offset, newline === -1 ? source.length : newline);
    if (fence) {
      markRange(mask, offset, end);
      const closing = line.match(/^ {0,3}([`~]+)[ \t]*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = line.match(/^ {0,3}([`~]{3,})(.*)$/);
      if (opening && [...opening[1]].every((char) => char === opening[1][0])) {
        fence = { marker: opening[1][0], length: opening[1].length };
        markRange(mask, offset, end);
      } else if (/^( {4}|\t)/.test(line)) markRange(mask, offset, end);
    }
    offset = end;
  }
}

function markInlineCode(source, mask) {
  for (let index = 0; index < source.length;) {
    if (mask[index] || source[index] !== '`') {
      index += 1;
      continue;
    }
    let length = 1;
    while (source[index + length] === '`' && !mask[index + length]) length += 1;
    let close = index + length;
    while (close < source.length) {
      close = source.indexOf('`', close);
      if (close === -1) break;
      if (mask[close]) {
        close += 1;
        continue;
      }
      let closeLength = 1;
      while (source[close + closeLength] === '`' && !mask[close + closeLength]) closeLength += 1;
      if (closeLength === length) break;
      close += closeLength;
    }
    if (close === -1 || close >= source.length) {
      index += length;
      continue;
    }
    markRange(mask, index, close + length);
    index = close + length;
  }
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function pairDelimiters(source, mask, open, close, replacement, replacements) {
  let opening = -1;
  for (let index = 0; index < source.length - 1; index += 1) {
    if (mask[index] || source[index] !== '\\' || isEscaped(source, index)) continue;
    const token = source.slice(index, index + 2);
    if (opening === -1 && token === open) opening = index;
    else if (opening !== -1 && token === close) {
      replacements.set(opening, replacement);
      replacements.set(index, replacement);
      opening = -1;
    }
  }
}

// remark-math deliberately recognizes dollar delimiters only. Agent CLIs also
// commonly emit LaTeX's \(...\) and \[...\] forms, so normalize those two
// equivalent spellings before CommonMark consumes their backslashes. Code
// fences, indented code, and code spans are masked first and remain literal.
export function normalizeMathMarkdown(value) {
  const source = String(value || '');
  if (!source.includes('\\(') && !source.includes('\\[')) return source;
  const mask = new Uint8Array(source.length);
  markFencedAndIndentedCode(source, mask);
  markInlineCode(source, mask);
  const replacements = new Map();
  pairDelimiters(source, mask, '\\[', '\\]', '$$', replacements);
  pairDelimiters(source, mask, '\\(', '\\)', '$', replacements);
  if (!replacements.size) return source;
  let normalized = '';
  for (let index = 0; index < source.length; index += 1) {
    const replacement = replacements.get(index);
    if (replacement) {
      normalized += replacement;
      index += 1;
    } else normalized += source[index];
  }
  return normalized;
}
