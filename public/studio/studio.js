(() => {
'use strict';
const C=window.ArtlinkStudio,$=id=>document.getElementById(id),q=new URLSearchParams(location.search),field=C.field(q.get('field')),ko=q.get('lang')!=='en';
const say=(a,b)=>ko?a:b;
const labels={acting:['연기','Acting'],music:['음악','Music'],art:['미술','Visual art'],dance:['무용','Dance'],literature:['문학','Writing'],film:['영화','Film']};
const config={
 acting:{title:['제출할 테이크를, 직접 골라보세요.','Choose the take you want to send.'],desc:['두 테이크를 보고, 장면의 의도와 선택 이유를 남기세요.','Review two takes and keep the intention behind your choice.'],roles:[['영상·셀프테이프','Screen / self-tape'],['무대·뮤지컬','Stage / musical'],['성우·낭독','Voice / reading']],task:['테이크 비교와 제출 준비','Take review & preparation']},
 music:{title:['어려운 구간만, 한 번 더.','One more pass at the difficult part.'],desc:['구간을 반복하고 두 녹음을 번갈아 들어보세요. 내가 바꾸려던 소리에 집중합니다.','Loop a phrase and switch between two recordings. Listen for the change you intended.'],roles:[['보컬','Vocals'],['악기 연주','Instrument'],['작곡·편곡·프로듀싱','Composition / production']],task:['구간 연습과 녹음 비교','Loop & compare recordings']},
 art:{title:['바뀐 부분을, 작품 위에서.','See what changed in your work.'],desc:['원본과 수정본을 나란히 놓고, 다시 보고 싶은 위치에 표시를 남기세요.','Place two versions side by side and mark the detail you want to revisit.'],roles:[['드로잉·회화','Drawing / painting'],['일러스트·디자인','Illustration / design'],['사진','Photography'],['조소·공예','Sculpture / craft']],task:['작품 비교와 위치 메모','Compare artwork & pin a note']},
 dance:{title:['같은 카운트에서, 함께 보세요.','Meet at the same count.'],desc:['동작의 시작점을 맞추고 천천히 반복하세요. 거울 모드로 방향도 맞출 수 있습니다.','Align the start of two movements, slow them down, and use mirror mode to match directions.'],roles:[['K-pop·스트리트','K-pop / street'],['발레','Ballet'],['한국무용·현대무용','Korean / contemporary'],['안무·팀 리허설','Choreography / rehearsal']],task:['동작 비교와 구간 반복','Movement comparison & loops']},
 literature:{title:['고친 문장에, 이유를 남기세요.','Keep the reason behind your revision.'],desc:['원문을 보존하며 수정한 문단을 비교하세요. 문장을 선택해 그 부분의 메모를 남길 수 있습니다.','Compare passages without losing your original. Select text to attach a revision note.'],roles:[['시·에세이','Poetry / essay'],['소설·웹소설','Fiction / serial'],['희곡·각본','Play / screenplay'],['비평·번역','Criticism / translation']],task:['문단별 퇴고와 수정 비교','Revise & compare passages']},
 film:{title:['이 컷에서, 무엇을 전할까요?','What should this cut tell us?'],desc:['두 편집본의 같은 장면을 보고 시점별 메모를 남기세요. 다음 편집에서 바꿀 점을 정리합니다.','Compare a scene in two edits and leave time-based notes for the next version.'],roles:[['연출·각본','Direction / screenplay'],['촬영','Cinematography'],['편집·VFX','Editing / VFX'],['다큐·애니메이션','Documentary / animation']],task:['편집본 비교와 컷 메모','Cut review & version notes']}
};
const conf=config[field],pick=a=>a[ko?0:1],text=(id,a,b)=>{$(id).textContent=say(a,b);};
document.documentElement.lang=ko?'ko':'en';document.title=pick(labels[field])+' · '+say('작품 작업실','ArtLink Studio');
$('heading').textContent=pick(conf.title);$('description').textContent=pick(conf.desc);$('task-title').textContent=pick(conf.task);text('eyebrow','ARTLINK / 여섯 가지 작업실','ARTLINK / SIX CREATIVE STUDIOS');text('mode-label','내 작품으로 시작','START WITH YOUR WORK');text('role-label','지금 하는 작업','Your practice');
$('language').textContent=ko?'English':'한국어';$('language').href=`?field=${field}&lang=${ko?'en':'ko'}`;
for(const f of C.FIELDS){const a=document.createElement('a');a.textContent=pick(labels[f]);a.href=`?field=${f}&lang=${ko?'ko':'en'}`;if(f===field)a.setAttribute('aria-current','page');$('fields').append(a);}
conf.roles.forEach((v,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=pick(v);$('role').append(o);});
text('privacy','작품 파일은 이 브라우저에만 남습니다. 앱으로 이어받기를 선택하고 동의한 경우에만 미리보기의 글·메모·설정을 임시 전송합니다. AI 평가 없이 직접 비교하는 도구입니다.','Artwork files stay in this browser. Text, notes and settings are temporarily transferred only when you preview and agree to continue in the app. This is a self-review tool without AI scoring.');
text('intent-label','이번 작업에서 바꾸려던 점','What did you intend to change?');$('intent').placeholder=say('예: 마지막 구간의 긴장감을 더 오래 유지하고 싶다.','For example: let the tension last longer in the final section.');text('comment-label','다음 작업에 남길 메모','A note for your next version');text('add-comment','메모 추가','Add note');text('export','작업 기록 내려받기','Download review');text('share','이 도구 링크 복사','Copy tool link');text('app','앱에서 기록 이어가기','Continue in the app');text('save-notice','다운로드에는 메모·설정이 포함됩니다. 원본 파일은 포함하지 않습니다. 링크 공유에도 내 작품·메모는 포함되지 않습니다.','The download contains notes and settings, not original media. Sharing the tool link never includes your work or notes.');text('closing-title','다음 버전까지 이어지는 기록.','A record that leads to your next version.');text('closing-copy','아트링크 앱에서 자료를 첨부하고 연습 기록과 AI 피드백을 이어갈 수 있어요. AI 피드백의 이용 한도와 구독 조건은 앱에서 확인하세요.','Attach your work in the ArtLink app to keep a practice record and request AI feedback. Check feedback allowances and subscription terms in the app.');text('learn','내 분야 더 알아보기 →','Explore my field →');$('learn').href=`/launch/${ko?'':'en/'}${field}/`;
$('app').removeAttribute('href');$('app').setAttribute('role','button');$('app').tabIndex=0;
let dirty=false,anchor=null,comments=[],versions={a:0,b:0},urls={},files={},players={},playing=false,playToken=0,loopTimer=null,selected='a',activeTargets=[];
const status=(a,b)=>text('status',a,b),changed=()=>{dirty=true;};
$('intent').addEventListener('input',changed);$('comment').addEventListener('input',changed);$('role').addEventListener('change',changed);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function element(tag,props={},parent){const el=document.createElement(tag);Object.entries(props).forEach(([k,v])=>k==='text'?el.textContent=v:k==='class'?el.className=v:el.setAttribute(k,v));if(parent)parent.append(el);return el;}
function setAnchor(value){anchor=value;$('anchor').textContent=value?say('메모 위치: ','Note location: ')+anchorLabel(value):say('위치를 선택하지 않으면 작업 전체에 메모를 남깁니다.','Without a selection, notes apply to the whole work.');}
function anchorLabel(a){if(!a)return say('작업 전체','Whole work');const name=a.side==='a'?'A':'B';if(a.kind==='image')return `${name} · ${Math.round(a.x*100)}%, ${Math.round(a.y*100)}%`;if(a.kind==='text')return `${name} · “${a.quote.slice(0,70)}”`;return `${name} · ${C.stamp(a.time)}`;}
function renderComments(){
 $('comments').replaceChildren();for(const [i,c] of comments.entries()){const li=element('li',{class:c.resolved?'resolved':''},$('comments'));const stale=c.anchor&&c.anchor.version!==versions[c.anchor.side];element('strong',{text:`${i+1}. ${anchorLabel(c.anchor)}${stale?say(' · 이전 자료의 메모',' · previous material'):''}`},li);element('div',{text:c.body},li);const b=element('button',{type:'button',text:c.resolved?say('다시 검토','Reopen'):say('해결 표시','Mark resolved')},li);b.onclick=()=>{c.resolved=!c.resolved;changed();renderComments();};}renderPins();
}
function renderPins(){if(field!=='art')return;for(const side of ['a','b']){const stage=$('stage-'+side);stage.querySelectorAll('.pin').forEach(n=>n.remove());for(const [i,c] of comments.entries()){const a=c.anchor;if(a?.kind==='image'&&a.side===side&&a.version===versions[side]){const p=element('span',{class:'pin',text:String(i+1)},stage);p.style.left=a.x*100+'%';p.style.top=a.y*100+'%';}}}}
$('add-comment').onclick=()=>{const body=$('comment').value.trim();if(!body){status('메모를 먼저 적어주세요.','Write a note first.');$('comment').focus();return;}if(comments.length>=100){status('이 작업의 메모는 100개까지 남길 수 있어요.','This review supports up to 100 notes.');return;}comments.push({anchor:anchor?{...anchor}:null,body,resolved:false});$('comment').value='';changed();renderComments();status('메모를 남겼어요.','Note added.');};
function replaceMaterial(side,url,name){stop();if(urls[side])URL.revokeObjectURL(urls[side]);urls[side]=url;files[side]=name;versions[side]++;if(anchor?.side===side)setAnchor(null);changed();renderComments();}
function filePane(side,accept){const pane=element('div',{class:'pane'},pair);element('label',{for:'file-'+side,text:side==='a'?say('A · 원본 / 첫 기록','A · Original / first take'):say('B · 수정본 / 다음 기록','B · Revision / next take')},pane);const wrap=element('div',{class:'file'},pane);const input=element('input',{id:'file-'+side,type:'file',accept},wrap);return {pane,input};}
const editor=$('editor'),pair=element('div',{class:'pair'},editor),bar=element('div',{class:'toolbar'},editor);
function button(label,handler,parent=bar){const b=element('button',{type:'button',text:label},parent);b.onclick=handler;return b;}
function number(id,label,value,parent=bar){const l=element('label',{text:label},parent);return element('input',{id,type:'number',min:'0',step:'0.1',value},l);}
function check(id,label,handler){const l=element('label',{class:'toggle'},bar),input=element('input',{type:'checkbox',id},l);l.append(document.createTextNode(label));input.onchange=handler;return input;}
function fileOK(file,kind){const max=kind==='image'?20:250;if(file.size>max*1024*1024){status(`파일은 ${max}MB 이하로 선택해주세요.`,`Choose a file under ${max} MB.`);return false;}const valid=kind==='image'?/^image\/(png|jpeg|webp|gif)$/.test(file.type):/^(audio|video)\//.test(file.type)||/\.(mp3|m4a|wav|ogg|mp4|mov|webm)$/i.test(file.name);if(!valid){status('지원하는 파일 형식을 선택해주세요.','Choose a supported file format.');return false;}return true;}
function stop(){playToken++;playing=false;activeTargets=[];if(loopTimer)clearInterval(loopTimer);loopTimer=null;Object.values(players).forEach(p=>p.pause());}
function readRange(side){const p=players[side],start=Number($('start').value),end=Number($('end').value),offset=side==='b'?Number($('offset').value):0;return p&&C.range(start+offset,end+offset,p.duration);}
async function play(side,sync=false){
 stop();const token=playToken,targets=sync?['a','b']:[side],ranges={};
 for(const s of targets){ranges[s]=readRange(s);if(!ranges[s]){status('두 구간이 각 파일의 길이 안에 있도록 시작·끝·B 시간차를 확인해주세요.','Check that start, end, and the B offset fit within each file.');return;}}
 selected=side;activeTargets=targets;playing=true;
 try{
  for(const s of targets){const p=players[s];p.currentTime=ranges[s].start;p.playbackRate=Number($('rate').value);p.preservesPitch=true;p.muted=sync&&s==='b';await p.play();if(token!==playToken)return;}
  loopTimer=setInterval(()=>{
   if(!playing||token!==playToken)return;
   if(targets.some(s=>players[s].currentTime>=ranges[s].end||players[s].ended)){
    if($('loop').checked){for(const s of targets){players[s].currentTime=ranges[s].start;players[s].play().catch(()=>{if(token===playToken){stop();status('재생을 다시 눌러주세요.','Press play to resume.');}});}}
    else stop();
   }
  },50);
  status('선택한 구간을 재생하고 있어요.','Playing the selected range.');
 }catch{if(token===playToken){stop();status('이 브라우저에서 파일을 재생할 수 없어요. MP4(H.264) 또는 MP3/WAV로 다시 선택해주세요.','This browser could not play the file. Try MP4 (H.264), MP3, or WAV.');}}
}
if(field==='literature'){
 for(const side of ['a','b']){const pane=element('div',{class:'pane'},pair);element('label',{for:'text-'+side,text:side==='a'?say('A · 원문','A · Original'):say('B · 수정본','B · Revision')},pane);const input=element('textarea',{id:'text-'+side,class:'writing',maxlength:'20000',placeholder:say('문단을 붙여넣으세요.','Paste your passage.')},pane);input.oninput=()=>{versions[side]++;changed();setAnchor(null);renderComments();renderDiff();};input.onselect=()=>{if(input.selectionEnd>input.selectionStart)setAnchor({kind:'text',side,version:versions[side],start:input.selectionStart,end:input.selectionEnd,quote:input.value.slice(input.selectionStart,input.selectionEnd).slice(0,300)});};}
 const output=element('div',{class:'diff',id:'diff','aria-live':'polite'},editor);function renderDiff(){output.replaceChildren();const result=C.diff($('text-a').value,$('text-b').value);if(result.limited){element('p',{text:say('문단이 많아요. 비교할 부분을 400문단 안으로 줄여주세요.','Too many paragraphs. Compare a shorter excerpt.')},output);return;}result.rows.forEach(row=>element('div',{class:row.kind,text:(row.kind==='add'?'+ ':row.kind==='remove'?'− ':'  ')+row.text},output));}
 button(say('직접 만든 예시로 보기','Try an original example'),()=>{if(($('text-a').value||$('text-b').value)&&!confirm(say('현재 입력을 예시로 바꿀까요? 먼저 작업 기록을 내려받을 수 있어요.','Replace current text with the example? Download your review first if needed.')))return;$('text-a').value=say('그는 떠나기가 아쉬웠다.\n그래도 문을 열고 나갔다.','He did not want to leave.\nStill, he opened the door and walked out.');$('text-b').value=say('그는 문고리를 잡은 채 식탁을 돌아봤다.\n컵에는 아직 김이 오르고 있었다.','His hand stayed on the handle as he looked back at the table.\nSteam still rose from the cup.');versions.a++;versions.b++;setAnchor(null);changed();renderComments();renderDiff();});
}else if(field==='art'){
 for(const side of ['a','b']){const {pane,input}=filePane(side,'image/png,image/jpeg,image/webp,image/gif');const stage=element('div',{class:'image-stage',id:'stage-'+side,tabindex:'0',role:'button','aria-label':say('이미지에서 메모 위치 선택. 키보드는 Enter로 중앙을 선택합니다.','Select a note location. Press Enter to select the center.')},pane);const img=element('img',{alt:side==='a'?say('원본 작품','Original artwork'):say('수정 작품','Revised artwork'),hidden:''},stage);input.onchange=()=>{const f=input.files[0];if(!f||!fileOK(f,'image'))return;replaceMaterial(side,URL.createObjectURL(f),f.name);img.src=urls[side];img.hidden=false;};const choose=(x,y)=>{if(img.hidden||!img.naturalWidth)return;const point=C.pin(x,y,stage.clientWidth,stage.clientHeight);if(point)setAnchor({kind:'image',side,version:versions[side],...point});};stage.onclick=e=>{const r=stage.getBoundingClientRect();choose(e.clientX-r.left,e.clientY-r.top);};stage.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(stage.clientWidth/2,stage.clientHeight/2);}};img.onerror=()=>{img.hidden=true;status('이미지를 열 수 없어요. JPG 또는 PNG를 선택해주세요.','Could not open the image. Try JPG or PNG.');};}
 check('gray',say('흑백으로 명암 보기','View values in grayscale'),e=>{pair.classList.toggle('grayscale',e.target.checked);changed();});
 button(say('직접 만든 예시로 보기','Try an original example'),()=>{if((files.a||files.b)&&!confirm(say('선택한 이미지를 예시로 바꿀까요?','Replace the selected images with the example?')))return;for(const side of ['a','b']){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e7dfcb"/><path d="M0 330L640 ${side==='a'?280:310}V480H0" fill="#b1b79a"/><ellipse cx="355" cy="365" rx="140" ry="35" fill="${side==='a'?'#8e937f':'#656e57'}"/><rect x="230" y="135" width="190" height="225" rx="70" fill="#b65c46"/><ellipse cx="325" cy="150" rx="70" ry="28" fill="#d09c72"/><path d="M265 180Q245 270 270 320" fill="none" stroke="${side==='a'?'#bd7353':'#e6bb89'}" stroke-width="24"/></svg>`;replaceMaterial(side,URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),`ArtLink original ${side.toUpperCase()}`);const img=$('stage-'+side).querySelector('img');img.src=urls[side];img.hidden=false;}});
}else{
 const audio=field==='music';for(const side of ['a','b']){const {pane,input}=filePane(side,audio?'audio/*,video/mp4':'video/*');const p=element(audio?'audio':'video',{controls:'',preload:'metadata',playsinline:'','aria-label':side==='a'?'A':'B'},pane);players[side]=p;input.onchange=()=>{const f=input.files[0];if(!f||!fileOK(f,'media'))return;replaceMaterial(side,URL.createObjectURL(f),f.name);p.src=urls[side];p.load();};p.onloadedmetadata=()=>{if(side==='a')$('end').value=String(Math.min(10,Math.floor(p.duration*10)/10));};p.onplay=()=>{if(!activeTargets.includes(side)){playToken++;playing=false;if(loopTimer)clearInterval(loopTimer);loopTimer=null;activeTargets=[side];Object.entries(players).forEach(([s,v])=>{if(s!==side)v.pause();});}};p.onpause=()=>{if(playing&&p.paused&&!p.ended&&activeTargets.includes(side))stop();};p.onerror=()=>{stop();status('파일 형식을 읽을 수 없어요. MP4(H.264) 또는 MP3/WAV로 변환해주세요.','Unsupported media. Try MP4 (H.264), MP3, or WAV.');};button(say(`${side.toUpperCase()} 현재 시점에 메모`,`${side.toUpperCase()}: note this moment`),()=>setAnchor({kind:'time',side,time:p.currentTime||0,version:versions[side]}),pane);}
 number('start',say('A 시작(초)','A start (s)'),0);number('end',say('A 끝(초)','A end (s)'),10);const offset=number('offset',say('B 시간차(초)','B offset (s)'),0);offset.removeAttribute('min');const rateLabel=element('label',{text:say('속도','Speed')},bar);const rate=element('select',{id:'rate'},rateLabel);[.5,.75,1,1.25].forEach(n=>{const o=element('option',{value:String(n),text:n+'×'},rate);o.selected=n===1;});check('loop',say('반복','Loop'),changed).checked=true;if(!audio)for(const side of ['a','b'])check('mirror-'+side,side.toUpperCase()+say(' 거울',' mirror'),e=>{players[side].style.transform=e.target.checked?'scaleX(-1)':'';changed();});
 for(const id of ['start','end','offset','rate'])$(id).oninput=()=>{stop();changed();};
 button(say('A 구간 듣기·보기','Play A range'),()=>play('a'));button(say('B 같은 구간','Play B range'),()=>play('b'));if(!audio)button(say('함께 보기 · A 소리','Play together · A sound'),()=>play('a',true));button(say('멈춤','Stop'),stop);
 element('p',{class:'muted',text:say('B 시간차 +2는 A의 0초와 B의 2초를 맞춥니다. 함께 보기는 기기 성능에 따라 조금 어긋날 수 있습니다.','A B offset of +2 aligns A at 0s with B at 2s. Side-by-side playback may drift slightly depending on your device.')},editor);
 if(field==='dance'){const count=number('count',say('이 구간의 시작 카운트','Starting count'),1);count.max='8';count.step='1';count.onchange=changed;}
 if(field==='acting'){const list=element('div',{class:'checklist'},editor);for(const [i,label] of [say('제출할 테이크를 직접 골랐어요.','I selected the take to submit.'),say('공고의 파일 형식·길이·이름을 확인했어요.','I checked the required format, duration, and file name.'),say('자기소개·프로필 등 제출물을 확인했어요.','I checked the introduction, profile, and required materials.')].entries()){const l=element('label',{},list);const c=element('input',{type:'checkbox',id:'check-'+i},l);l.append(document.createTextNode(label));c.onchange=changed;}}
}
setAnchor(null);
function reviewText(){
 const lines=['ARTLINK · '+pick(conf.task),new Date().toISOString(),pick(conf.roles[Number($('role').value)]),'',say('이번 작업의 의도','Intention'),$('intent').value,''];
 for(const side of ['a','b'])if(files[side])lines.push(side.toUpperCase()+': '+files[side]);
 if(field==='literature')lines.push('','A · '+say('원문','Original'),$('text-a').value,'','B · '+say('수정본','Revision'),$('text-b').value);
 if(players.a)lines.push('',`${say('구간','Range')}: ${$('start').value}–${$('end').value}s / B +${$('offset').value}s / ${$('rate').value}×`,`${say('반복','Loop')}: ${$('loop').checked}`,`${say('거울 A/B','Mirror A/B')}: ${!!$('mirror-a')?.checked}/${!!$('mirror-b')?.checked}`);
 if($('count'))lines.push(say('시작 카운트: ','Starting count: ')+$('count').value);
 lines.push('',say('작업 메모','Review notes'));
 comments.forEach((c,i)=>lines.push(`${i+1}. [${c.resolved?say('해결','Resolved'):say('검토','Open')}] ${anchorLabel(c.anchor)}${c.anchor&&c.anchor.version!==versions[c.anchor.side]?say(' (이전 자료)',' (previous material)'):''}`,c.body,''));
 if($('comment').value.trim())lines.push(say('작성 중 메모 · ','Draft note · ')+anchorLabel(anchor),$('comment').value);
 if(field==='acting')for(const i of [0,1,2])lines.push(($('check-'+i).checked?'[x] ':'[ ] ')+$('check-'+i).parentElement.textContent);
 return lines.join('\n');
}
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([reviewText()],{type:'text/plain;charset=utf-8'}));const a=element('a',{href:url,download:`artlink-${field}-review.txt`},document.body);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;status('작업 기록 다운로드를 시작했어요. 작성 중인 메모도 포함됩니다. 원본 파일은 따로 보관해주세요.','Review download started, including your draft note. Keep original media separately.');};
$('share').onclick=async()=>{try{await navigator.clipboard.writeText(C.campaignLink(location.origin,field,ko?'ko':'en'));status('도구 링크를 복사했어요. 내 작품과 메모는 포함되지 않아요.','Tool link copied. Your work and notes are not included.');}catch{status('주소창의 링크를 복사해주세요. 내 작품과 메모는 주소에 포함되지 않아요.','Copy the URL from your address bar. It contains no work or notes.');}};

function transferReview(){
 const notes=comments.map(c=>({body:c.body,label:anchorLabel(c.anchor)+(c.anchor&&c.anchor.version!==versions[c.anchor.side]?say(' · 이전 자료',' · previous material'):''),resolved:c.resolved}));
 if($('comment').value.trim())notes.push({body:$('comment').value.trim(),label:say('작성 중 · ','Draft · ')+anchorLabel(anchor),resolved:false});
 const settings={};
 if(players.a&&files.a){for(const key of ['start','end','offset','rate']){if($(key).value.trim()==='')throw Error('INVALID_REVIEW');settings[key]=Number($(key).value);}settings.loop=$('loop').checked;settings.mirrorA=!!$('mirror-a')?.checked;settings.mirrorB=!!$('mirror-b')?.checked;}
 if($('count'))settings.count=Number($('count').value);
 if($('gray'))settings.gray=$('gray').checked;
 if(field==='acting')settings.checks=[0,1,2].map(i=>$('check-'+i).checked);
 return window.ArtlinkTransfer.normalize({version:1,field,lang:ko?'ko':'en',title:pick(conf.task),role:pick(conf.roles[Number($('role').value)]),intent:$('intent').value,notes,settings,...(field==='literature'?{texts:{a:$('text-a').value,b:$('text-b').value}}:{})});
}
async function transferRequest(body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const r=await fetch('/api/studio-transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(data.error||'UNAVAILABLE');return data;}finally{clearTimeout(timer);}
}
$('app').onclick=e=>{
 e?.preventDefault();stop();let snapshot;
 try{snapshot=transferReview();}catch{status('먼저 메모나 비교할 글을 남겨주세요. 구간은 올바른 시작·끝으로 설정해주세요.','Add a note or text first, and check the start and end of your range.');return;}
 const dialog=element('dialog',{'aria-labelledby':'handoff-title',class:'handoff'},document.body);
 element('h2',{id:'handoff-title',text:say('앱으로 가져갈 기록','Your review for the app')},dialog);
 element('p',{text:say('아래 내용만 전송합니다. 사진·영상·음원 원본과 파일명은 포함하지 않습니다.','Only the preview below is transferred. Media files and file names are excluded.')},dialog);
 element('pre',{class:'transfer-preview',text:window.ArtlinkTransfer.describe(snapshot)},dialog);
 const label=element('label',{class:'transfer-consent'},dialog),consent=element('input',{type:'checkbox'},label);
 label.append(document.createTextNode(say('이 글·메모·설정을 암호화하여 임시 보관하고 앱으로 가져오는 데 동의합니다. 코드는 24시간 유효하며 만료 사본은 정기 삭제됩니다. 코드를 아는 사람은 기록을 가져올 수 있습니다.','I agree to temporarily store this text, notes and settings encrypted for import. The code expires in 24 hours; expired copies are periodically deleted. Anyone with the code can import the review.')));
 const actions=element('div',{class:'actions'},dialog),submit=button(say('전송 코드 만들기','Create transfer code'),async()=>{
  submit.disabled=true;close.disabled=true;message.textContent=say('기록을 준비하고 있어요…','Preparing your review…');
  try{
   const data=await transferRequest({action:'create',review:snapshot});if(!window.ArtlinkTransfer.code(data.code))throw Error('UNAVAILABLE');
   const target=new URL('/studio/receive.html',location.origin);target.hash=new URLSearchParams({code:data.code,lang:ko?'ko':'en'}).toString();
   consent.disabled=true;submit.hidden=true;message.textContent=say('코드를 만들었어요. 앱에서 내용을 확인하고 저장하세요. 웹의 원본 작업은 그대로 남아 있습니다.','Your code is ready. Preview and save in the app. Your original browser work remains here.');
   element('p',{class:'transfer-code',text:data.code.match(/.{4}/g).join('-')},dialog);
   const open=element('a',{class:'button primary',href:'artlink://studio-import?code='+data.code,text:say('앱에서 확인하고 저장','Preview and save in ArtLink')},actions);
   const copy=button(say('다른 기기에서 열 링크 복사','Copy link for another device'),async()=>{try{await navigator.clipboard.writeText(target.href);message.textContent=say('전송 링크를 복사했어요. 본인 휴대폰에서 열어주세요.','Transfer link copied. Open it on your phone.');}catch{message.textContent=target.href;}},actions);
   element('a',{class:'button',href:target.href,target:'_blank',rel:'noopener',text:say('설치·업데이트 후 이어받기','Install / update and return')},actions);
   const revoke=button(say('전송 코드 취소','Revoke transfer code'),async()=>{revoke.disabled=true;try{await transferRequest({action:'revoke',code:data.code});open.remove();copy.remove();actions.querySelectorAll('a').forEach(a=>a.remove());message.textContent=say('코드를 취소했어요. 이미 앱에 저장한 기록은 앱에서 삭제할 수 있습니다.','Code revoked. Any already saved note can be deleted in the app.');}catch{revoke.disabled=false;message.textContent=say('취소하지 못했어요. 잠시 후 다시 눌러주세요.','Could not revoke. Try again shortly.');}},actions);
  }catch(err){submit.disabled=!consent.checked;message.textContent=err.message==='TRY_AGAIN'?say('잠시 후 다시 시도해주세요. 기존 작업은 남아 있습니다.','Try again shortly. Your work is still here.'):say('전송하지 못했어요. 다시 시도하거나 작업 기록을 내려받아 보관해주세요.','Transfer failed. Retry or download your review to keep it.');}
  finally{close.disabled=false;}
 },actions);
 submit.classList.add('primary');submit.disabled=true;consent.onchange=()=>{submit.disabled=!consent.checked;};
 const close=button(say('작업실로 돌아가기','Back to my work'),()=>dialog.close(),actions),message=element('p',{role:'status','aria-live':'polite'},dialog);
 dialog.addEventListener('close',()=>{$('app').focus();dialog.remove();});dialog.addEventListener('cancel',e=>{if(close.disabled)e.preventDefault();});dialog.showModal();
};
$('app').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('app').click();}};

document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',()=>{stop();Object.values(urls).forEach(URL.revokeObjectURL);});
})();
