(() => {
 'use strict';
 const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1)),code=window.ArtlinkTransfer.code(params.get('code')),en=params.get('lang')==='en';
 if(en){document.documentElement.lang='en';$('title').textContent='Continue your review';$('help').textContent='Preview your review in the app, then save it.';$('open').textContent='Preview and save in ArtLink';$('code-label').textContent='On another device, go to My notes → Import web review and enter this code.';$('copy').textContent='Copy code';$('notice').textContent='This code is valid for 24 hours. Anyone with the code can import the review. Return here after installing or updating ArtLink. Original media files are not included.';$('back').textContent='Back to the studio';}
 if(!code){$('status').textContent=en?'Invalid transfer link. Return to the studio to create a new code.':'전송 링크가 올바르지 않아요. 작업실에서 코드를 다시 만들어주세요.';$('copy').disabled=true;return;}
 $('code').textContent=code.match(/.{4}/g).join('-');$('open').href='artlink://studio-import?code='+code;$('open').hidden=false;
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);$('status').textContent=en?'Code copied.':'코드를 복사했어요.';}catch{$('status').textContent=en?'Select and copy the code above.':'위 코드를 선택해 복사해주세요.';}};
})();
