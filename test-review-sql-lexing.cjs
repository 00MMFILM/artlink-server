const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  checkSqlLexing
} = require('./scripts/check-sql-lexing.cjs');
const read = name => fs.readFileSync(`${__dirname}/migrations/${name}`, 'utf8');
test('group and review migrations have balanced SQL and PL/pgSQL delimiters (not a database execution test)', () => {
  for (const name of ['2026-10-11-private-groups.sql', '2026-10-15-group-assignments.sql', '2026-10-23-six-field-assignments.sql', '2026-10-23-review-rooms.sql']) checkSqlLexing(read(name), name);
});
test('the previously missing field quote is detected inside the function body', () => {
  const sql = read('2026-10-23-review-rooms.sql');
  const broken = sql.replace("p_payload->>'field',g.id", "p_payload->>'field,g.id");
  assert.notEqual(broken, sql);
  assert.throws(() => checkSqlLexing(broken), SyntaxError);
});
test('quoted punctuation and nested comments are ignored, unfinished tokens are rejected', () => {
  checkSqlLexing(`select 'it''s )', E'can\\'t', $tag$([']$tag$; /* outer /* inner */ done */`);
  for (const sql of ["select 'oops", 'select (1;', '/* missing end', 'select $tag$unfinished']) assert.throws(() => checkSqlLexing(sql), SyntaxError);
});
