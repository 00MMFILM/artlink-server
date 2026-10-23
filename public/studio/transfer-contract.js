(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArtlinkTransfer=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const FIELDS=['acting','music','art','dance','literature','film'];
  const fail=()=>{throw new Error('INVALID_REVIEW');};
  function string(v,max){if(typeof v!=='string'||v.length>max)fail();return v;}
  function normalize(raw){
    if(!raw||raw.version!==1||!FIELDS.includes(raw.field)||!['ko','en'].includes(raw.lang))fail();
    const result={version:1,field:raw.field,lang:raw.lang,title:string(raw.title,120),role:string(raw.role,120),intent:string(raw.intent,2000)};
    if(!Array.isArray(raw.notes)||raw.notes.length>101)fail();
    if(raw.notes.some(n=>!n||typeof n!=='object'))fail();
    result.notes=raw.notes.map(n=>({body:string(n.body,1000),label:string(n.label,400),resolved:n.resolved===true}));
    const s=raw.settings||{};result.settings={};
    for(const key of ['start','end','offset','rate','count'])if(s[key]!==undefined){if(typeof s[key]!=='number'||!Number.isFinite(s[key])||Math.abs(s[key])>86400)fail();result.settings[key]=s[key];}
    if((s.start===undefined)!==(s.end===undefined))fail();
    if(s.start!==undefined&&(s.start<0||s.end<=s.start))fail();
    if(s.rate!==undefined&&![.5,.75,1,1.25].includes(s.rate))fail();
    if(s.count!==undefined&&(!Number.isInteger(s.count)||s.count<1||s.count>8))fail();
    for(const key of ['loop','mirrorA','mirrorB','gray'])if(typeof s[key]==='boolean')result.settings[key]=s[key];
    if(Array.isArray(s.checks)&&s.checks.length===3)result.settings.checks=s.checks.map(v=>v===true);
    if(raw.field==='literature')result.texts={a:string(raw.texts?.a,20000),b:string(raw.texts?.b,20000)};
    if(!result.intent.trim()&&!result.notes.some(n=>n.body.trim())&&!result.texts?.a.trim()&&!result.texts?.b.trim()&&s.start===undefined)throw new Error('EMPTY_REVIEW');
    return result;
  }
  function code(value){const s=typeof value==='string'?value.replace(/[\s-]/g,'').toLowerCase():'';return /^[a-f0-9]{24}$/.test(s)?s:null;}
  function describe(raw){
    const p=normalize(raw),ko=p.lang==='ko',s=p.settings;
    const lines=[p.title,p.role,'',ko?'이번 작업의 의도':'Intention',p.intent];
    if(p.texts)lines.push('',ko?'A · 원문':'A · Original',p.texts.a,'',ko?'B · 수정본':'B · Revision',p.texts.b);
    if(s.start!==undefined)lines.push('',`${ko?'비교 구간':'Range'}: ${s.start}–${s.end}s / B ${s.offset>=0?'+':''}${s.offset||0}s / ${s.rate||1}×`,`${ko?'반복':'Loop'}: ${!!s.loop}`,`${ko?'거울 A/B':'Mirror A/B'}: ${!!s.mirrorA}/${!!s.mirrorB}`);
    if(s.count!==undefined)lines.push(`${ko?'시작 카운트':'Starting count'}: ${s.count}`);
    if(s.gray!==undefined)lines.push(`${ko?'흑백 보기':'Grayscale'}: ${s.gray}`);
    if(s.checks)lines.push(`${ko?'제출 전 확인':'Submission checks'}: ${s.checks.map(v=>v?'✓':'—').join(' / ')}`);
    lines.push('',ko?'작업 메모':'Review notes');
    p.notes.forEach(n=>lines.push(`[${n.resolved?(ko?'해결':'Resolved'):(ko?'검토':'Open')}] ${n.label}`,n.body,''));
    return lines.join('\n');
  }
  return {normalize,code,describe};
});
