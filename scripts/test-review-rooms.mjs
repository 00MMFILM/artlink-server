import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { checkSqlLexing } from './check-sql-lexing.cjs';
const migrationFiles = ['2026-10-11-private-groups.sql', '2026-10-15-group-assignments.sql', '2026-10-23-six-field-assignments.sql', '2026-10-23-review-rooms.sql'];
for (const file of migrationFiles) checkSqlLexing(fs.readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'), file);
const {
  PGlite
} = createRequire(import.meta.url)(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const db = new PGlite(),
  ids = Array.from({
    length: 7
  }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
let count = 0;
const check = (a, b) => {
  assert.deepEqual(a, b);
  count++;
};
const denied = async (fn, re) => {
  await assert.rejects(fn, re);
  count++;
};
await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
for (const id of ids) await db.query('insert into auth.users values($1)', [id]);
for (const file of migrationFiles) await db.exec(fs.readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
async function role(r, id = null) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
    sub: id,
    is_anonymous: false
  })]);
  await db.exec('set role ' + r);
}
async function review(u, a, r = null, p = {}) {
  return (await db.query('select public.artlink_review_action($1,$2,$3,$4) result', [u, a, r, JSON.stringify(p)])).rows[0].result;
}
async function rpc(name, args) {
  return (await db.query(`select public.${name}($1,$2,$3) result`, args)).rows[0].result;
}
await role('service_role');
const room = await review(ids[0], 'create', null, {
  title: 'Original music',
  field: 'music',
  consent: true,
  clientId: ids[0]
});
check((await review(ids[0], 'create', null, {
  title: 'retry',
  field: 'music',
  consent: true,
  clientId: ids[0]
})).id, room.id);
await denied(() => review(null, 'read', room.id), /ACCESS_DENIED/);
await denied(() => review(ids[1], 'read', room.id), /ACCESS_DENIED/);
const v = await review(ids[0], 'reserve', room.id, {
  kind: 'text',
  body: 'First\n\nSecond',
  reviewRequest: ' Where does the rhythm break? ',
  changeNote: ' A first draft. ',
  clientId: ids[1]
});
check(v.ready, true);
check(v.review_request, 'Where does the rhythm break?');
check(v.change_note, 'A first draft.');
await denied(() => review(ids[0], 'reserve', room.id, {
  kind: 'text',
  body: 'Work',
  clientId: ids[6],
  reviewRequest: 'x'.repeat(401)
}), /INVALID_BRIEF/);
await denied(() => review(ids[0], 'reserve', room.id, {
  kind: 'text',
  body: 'Work',
  clientId: ids[6],
  changeNote: ['not a string']
}), /INVALID_BRIEF/);
check((await review(ids[0], 'reserve', room.id, {
  kind: 'text',
  body: 'retry',
  clientId: ids[1]
})).id, v.id);
await review(ids[0], 'link', room.id, {
  newHash: 'a'.repeat(64)
});
check((await review(null, 'read', room.id, {
  linkHash: 'a'.repeat(64)
})).versions.length, 1);
await denied(() => review(null, 'comment', room.id, {
  linkHash: 'a'.repeat(64)
}), /LOGIN_REQUIRED/);
const c = await review(ids[1], 'comment', room.id, {
  linkHash: 'a'.repeat(64),
  versionId: v.id,
  clientId: ids[2],
  body: 'A precise note',
  authorName: 'Reviewer',
  anchor: {
    kind: 'general'
  }
});
check((await review(ids[1], 'comment', room.id, {
  linkHash: 'a'.repeat(64),
  versionId: v.id,
  clientId: ids[2],
  body: 'retry',
  authorName: 'Reviewer',
  anchor: {
    kind: 'general'
  }
})).id, c.id);
await denied(() => review(ids[1], 'resolve', room.id, {
  linkHash: 'a'.repeat(64),
  commentId: c.id,
  resolved: true
}), /OWNER_REQUIRED/);
await review(ids[0], 'resolve', room.id, {
  commentId: c.id,
  resolved: true
});
check((await review(ids[0], 'read', room.id)).comments[0].resolved, true);
await review(ids[0], 'link', room.id, {
  newHash: null
});
await denied(() => review(ids[1], 'read', room.id, {
  linkHash: 'a'.repeat(64)
}), /ACCESS_DENIED/);
await role('authenticated', ids[0]);
await denied(() => review(ids[0], 'read', room.id), /permission denied/);
await denied(() => db.query('select * from public.artlink_review_rooms'), /permission denied/);
const group = await rpc('artlink_group_action', ['create', null, JSON.stringify({
  name: 'Dance lab',
  kind: 'dance',
  displayName: 'Teacher'
})]);
const invite = await rpc('artlink_group_action', ['invite', group.id, '{}']);
const assignment = await rpc('artlink_assignment_action', ['create', group.id, JSON.stringify({
  title: '8 counts',
  instructions: 'A phrase',
  field: 'dance',
  clientId: ids[0]
})]);
check(assignment.field, 'dance');
await role('authenticated', ids[1]);
await rpc('artlink_group_action', ['join', null, JSON.stringify({
  code: invite.code,
  displayName: 'Dancer'
})]);
await role('authenticated', ids[2]);
await rpc('artlink_group_action', ['join', null, JSON.stringify({
  code: invite.code,
  displayName: 'Other dancer'
})]);
await role('service_role');
const gr = await review(ids[1], 'create', null, {
  title: 'Phrase',
  field: 'dance',
  assignmentId: assignment.id,
  consent: true,
  clientId: ids[3]
});
check((await review(ids[0], 'read', gr.id)).owner, false);
await denied(() => review(ids[2], 'read', gr.id), /ACCESS_DENIED/);
await denied(() => review(ids[1], 'link', gr.id, {
  newHash: 'a'.repeat(64)
}), /PRIVATE_ASSIGNMENT/);
await denied(() => review(ids[1], 'create', null, {
  title: 'Wrong field',
  field: 'music',
  assignmentId: assignment.id,
  consent: true,
  clientId: ids[4]
}), /ASSIGNMENT_CLOSED_OR_FIELD/);
await role('authenticated', ids[0]);
await rpc('artlink_group_action', ['remove_member', group.id, JSON.stringify({
  userId: ids[1]
})]);
await role('service_role');
await denied(() => review(ids[1], 'read', gr.id), /ACCESS_DENIED/);
// Removal revokes viewing, but the owner still has a way to remove their files.
check((await review(ids[1], 'list')).find(r => r.id === gr.id).owner, true);
await review(ids[1], 'begin_delete', gr.id);
check((await review(ids[1], 'list')).find(r => r.id === gr.id).deleting, true);
await review(ids[1], 'delete', gr.id);
await denied(() => review(ids[1], 'read', gr.id), /NOT_FOUND/);
await review(ids[0], 'begin_delete', room.id);
await denied(() => review(ids[0], 'read', room.id), /NOT_FOUND/);
await denied(() => review(ids[0], 'reserve', room.id, {
  kind: 'text',
  body: 'late',
  clientId: ids[4]
}), /NOT_FOUND/);
await review(ids[0], 'delete', room.id);
await denied(() => review(ids[0], 'read', room.id), /NOT_FOUND/);
await role('anon');
await denied(() => review(null, 'read', gr.id, {
  linkHash: 'a'.repeat(64)
}), /permission denied/);
await db.close();
console.log(`PASS ${count} review-room PostgreSQL checks.`);
