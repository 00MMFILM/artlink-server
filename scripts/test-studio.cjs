const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/studio/core');
test('loops reject invalid, reversed and offset ranges', () => {
  assert.deepEqual(C.range(2, 3, 12), {start:2,end:3});
  for (const args of [[-1,3,12],[3,3,12],[4,3,12],[0,13,12],[0,1,NaN],[0,Infinity,12]]) assert.equal(C.range(...args), null);
});
test('revision preserves Unicode and reconstructs both versions', () => {
  const before='겨울의 문장\n같은 문단\n🌸 남겨둘 말', after='새 문장\n같은 문단\n🌸 남겨둘 말\n끝';
  const {rows}=C.diff(before,after);
  assert.equal(rows.filter(r=>r.kind!=='add').map(r=>r.text).join('\n'),before);
  assert.equal(rows.filter(r=>r.kind!=='remove').map(r=>r.text).join('\n'),after);
  assert.equal(C.diff('x\n'.repeat(500),'y\n'.repeat(500)).limited,true);
});
test('image anchors stay relative and bounded', () => {
  assert.deepEqual(C.pin(100,50,200,100),{x:.5,y:.5});
  assert.deepEqual(C.pin(-10,150,200,100),{x:0,y:1});
  assert.equal(C.pin(0,0,0,100),null);
});
test('shared links contain only whitelisted routing, never user text', () => {
 for(const field of C.FIELDS){const u=new URL(C.campaignLink('https://art-link.kr',field,'en'));assert.equal(u.searchParams.get('field'),field);assert.deepEqual([...u.searchParams.keys()],['field','lang','source']);}
 assert.equal(new URL(C.campaignLink('https://art-link.kr','private words','bad')).searchParams.get('field'),'art');
});
