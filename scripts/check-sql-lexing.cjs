// Offline lexical guard only. PostgreSQL execution is still required before release.
// It checks quoting/comments/delimiters, including PL/pgSQL function bodies;
// it does not validate SQL grammar, schema references, privileges or RPC behavior.
function checkSqlLexing(source, label = 'SQL') {
  const stack = [];
  const fail = (message, offset) => {
    throw new SyntaxError(`${label}:${source.slice(0, offset).split('\n').length}: ${message}`);
  };
  let i = 0,
    statement = 0;
  while (i < source.length) {
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (source.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) fail('Unclosed block comment', start);
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const start = i,
        quote = source[i++];
      const escaped = quote === "'" && /(?:^|[^\w])e$/i.test(source.slice(0, start));
      let closed = false;
      while (i < source.length) {
        if (escaped && source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i++] !== quote) continue;
        if (source[i] === quote) {
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) fail('Unclosed quoted value', start);
      continue;
    }
    const tag = source[i] === '$' && source.slice(i).match(/^\$(?:[a-z_][a-z_0-9]*)?\$/i)?.[0];
    if (tag) {
      const start = i + tag.length,
        end = source.indexOf(tag, start);
      if (end < 0) fail('Unclosed dollar quote', i);
      if (/\blanguage\s+plpgsql\b/i.test(source.slice(statement, i))) {
        checkSqlLexing(source.slice(start, end), `${label} function at line ${source.slice(0, start).split('\n').length}`);
      }
      i = end + tag.length;
      continue;
    }
    if ('(['.includes(source[i])) stack.push({
      char: source[i],
      at: i
    });
    if (')]'.includes(source[i])) {
      const open = stack.pop();
      if (!open || (source[i] === ')' ? open.char !== '(' : open.char !== '[')) fail('Unmatched closing delimiter', i);
    }
    if (source[i] === ';') statement = i + 1;
    i++;
  }
  if (stack.length) fail('Unclosed delimiter', stack.at(-1).at);
}
module.exports = {
  checkSqlLexing
};
