/**
 * Splits a SQL script into statements without breaking function bodies.
 * Handles single/double quotes, line/block comments and $$-quoted blocks.
 */
export function splitSql(source) {
  const text = String(source || '');
  const statements = [];
  let buffer = '';
  let mode = 'normal';
  let dollarTag = '';
  let i = 0;

  while (i < text.length) {
    const character = text[i];
    const next = text[i + 1];

    if (mode === 'line') {
      buffer += character;
      if (character === '\n') mode = 'normal';
      i += 1;
      continue;
    }
    if (mode === 'block') {
      buffer += character;
      if (character === '*' && next === '/') {
        buffer += next;
        i += 2;
        mode = 'normal';
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'single') {
      buffer += character;
      if (character === "'") {
        if (next === "'") {
          buffer += next;
          i += 2;
          continue;
        }
        mode = 'normal';
      }
      i += 1;
      continue;
    }
    if (mode === 'double') {
      buffer += character;
      if (character === '"') {
        if (next === '"') {
          buffer += next;
          i += 2;
          continue;
        }
        mode = 'normal';
      }
      i += 1;
      continue;
    }
    if (mode === 'dollar') {
      if (text.startsWith(dollarTag, i)) {
        buffer += dollarTag;
        i += dollarTag.length;
        mode = 'normal';
        continue;
      }
      buffer += character;
      i += 1;
      continue;
    }

    if (character === '-' && next === '-') {
      mode = 'line';
      buffer += character + next;
      i += 2;
      continue;
    }
    if (character === '/' && next === '*') {
      mode = 'block';
      buffer += character + next;
      i += 2;
      continue;
    }
    if (character === "'") {
      mode = 'single';
      buffer += character;
      i += 1;
      continue;
    }
    if (character === '"') {
      mode = 'double';
      buffer += character;
      i += 1;
      continue;
    }
    if (character === '$') {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (match) {
        dollarTag = match[0];
        mode = 'dollar';
        buffer += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (character === ';') {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = '';
      i += 1;
      continue;
    }
    buffer += character;
    i += 1;
  }

  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
}
