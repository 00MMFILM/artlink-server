import assert from 'node:assert/strict';
import {summarizeFeedbackActivation,loadFeedbackActivation} from '../api/_feedbackActivation.js';
const now=Date.parse('2026-10-16T00:00:00Z'), day=86400000;
const row=(device,event,days,session,extra={})=>({device_id:device,event,kind:'text',field:'acting',session_id:session,occurred_at:new Date(now-days*day).toISOString(),received_at:new Date(now-days*day).toISOString(),...extra});
const rows=[
 row('repeat','ai_feedback_done',10,'first'),row('repeat','practice_completed',10,'first'),row('repeat','practice_completed',9,'second'),
 row('checkin','ai_feedback_done',10,'first'),row('checkin','practice_completed',9,'checkin',{kind:'checkin'}),
 row('same','ai_feedback_done',10,'first'),row('same','practice_completed',9,'first'),
 row('young','ai_feedback_done',1,'first'),row('young','practice_completed',0,'second'),
 row('qa','ai_feedback_done',10,'first'),row('qa','practice_completed',9,'second'),
 row('future','ai_feedback_done',-1,'first'),row('late','ai_feedback_done',10,'first'),row('late','practice_completed',2,'second'),
 row('nosession','ai_feedback_done',10,null),row('boundary','ai_feedback_done',7,'first'),row('boundary','practice_completed',0,'second'),
 row('old','ai_feedback_done',40,'first'),row('old','ai_feedback_done',1,'new'),row('old','practice_completed',0,'new'),
 row('badclock','ai_feedback_done',5,'first',{received_at:new Date(now-10*day).toISOString()}),
];
const report=summarizeFeedbackActivation(rows,{now,excludedDeviceIds:['qa']});
assert.equal(report.firstFeedbackDevices28d,7);
assert.deepEqual(report.afterFirstFeedback7d,{observedDevices:6,repeatedDevices:2,pct:33.3});
assert.equal(report.definition.invalidTimeEvents,2);
assert.equal(report.firstFeedbackByField.acting,7);
assert.equal(JSON.stringify(report).includes('repeat'),true); // aggregate key only
assert.ok(!JSON.stringify(report).includes('nosession'));
assert.equal(summarizeFeedbackActivation([],{now}).afterFirstFeedback7d.pct,null);
function client(source,insert=()=>{}){
 const pages=[];
 return {pages,from(table){assert.equal(table,'practice_events');let projection,upper,cursor,ascending,until,received;
  return {select(v){projection=v;return this;},in(k,v){assert.equal(k,'event');assert.deepEqual(v,['ai_feedback_done','practice_completed']);return this;},order(k,v){ascending=v.ascending;return this;},lte(k,v){if(k==='id')upper=v;else until=v;return this;},gt(k,v){cursor=v;return this;},or(v){received=v;return this;},async limit(n){
   if(projection!=='id'){pages.push({upper,cursor});insert(pages.length);assert.equal(until,new Date(now).toISOString());assert.equal(received,`received_at.is.null,received_at.lte.${until}`);}
   return {data:source.filter(r=>(!upper||BigInt(r.id)<=BigInt(upper))&&(!cursor||BigInt(r.id)>BigInt(cursor))).sort((a,b)=>(BigInt(a.id)<BigInt(b.id)?-1:1)*(ascending?1:-1)).slice(0,n)};
  }};
 }};
}
const many=Array.from({length:1005},(_,i)=>({id:i+1,...row('d'+i,'ai_feedback_done',10,'first')}));
const mock=client(many,page=>{if(page===2)many.push({id:1006,...row('concurrent','ai_feedback_done',10,'first')});});
const loaded=await loadFeedbackActivation(mock,{now});
assert.equal(loaded.firstFeedbackDevices28d,1005);assert.equal(mock.pages.length,2);assert.equal(mock.pages[1].cursor,'1000');assert.equal(mock.pages[1].upper,'1005');
assert.deepEqual(await loadFeedbackActivation(client([]),{now}),summarizeFeedbackActivation([],{now}));
await assert.rejects(loadFeedbackActivation(client([{id:Number.MAX_SAFE_INTEGER+1}]),{now}),/cursor/);
assert.equal((await loadFeedbackActivation(client([{id:'9007199254740993',...row('large','ai_feedback_done',10,'first')}]),{now})).firstFeedbackDevices28d,1);
await assert.rejects(loadFeedbackActivation({from(){return{select(){return this},in(){return this},order(){return this},limit:async()=>({error:new Error('offline outage')})}}},{now}),/outage/);
console.log('PASS feedback activation: mature distinct-session cohorts, check-in/test exclusion, 1005-row snapshot, safe cursors, unavailable is not zero.');
