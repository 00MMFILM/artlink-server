(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArtlinkStudio=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const FIELDS=['acting','music','art','dance','literature','film'];
  function field(value){return FIELDS.includes(value)?value:'art';}
  function range(start,end,duration){
    const a=Number(start),b=Number(end),d=Number(duration);
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(d)||a<0||b<=a||d<=0||b>d+0.05)return null;
    return {start:a,end:Math.min(b,d)};
  }
  function pin(x,y,w,h){if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return null;return {x:Math.max(0,Math.min(1,x/w)),y:Math.max(0,Math.min(1,y/h))};}
  function diff(before,after){
    const a=String(before).slice(0,20000).split('\n'),b=String(after).slice(0,20000).split('\n');
    if(a.length*b.length>160000)return {limited:true,rows:[]};
    const table=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i][j]=a[i]===b[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
    const rows=[];let i=0,j=0;
    while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:'same',text:a[i],before:++i,after:++j});}else if(j<b.length&&(i===a.length||table[i][j+1]>=table[i+1][j])){rows.push({kind:'add',text:b[j],after:++j});}else{rows.push({kind:'remove',text:a[i],before:++i});}}
    return {limited:false,rows};
  }
  function stamp(sec){const n=Math.max(0,Number(sec)||0);return `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;}
  function campaignLink(origin,kind,lang){const u=new URL('/studio/',origin);u.searchParams.set('field',field(kind));u.searchParams.set('lang',lang==='en'?'en':'ko');u.searchParams.set('source','shared_tool');return u.href;}
  return {FIELDS,field,range,pin,diff,stamp,campaignLink};
});
