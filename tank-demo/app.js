(function () {
 'use strict';
 const $=id=>document.getElementById(id), $$=s=>Array.from(document.querySelectorAll(s));
 const SAVE_KEY='tank-skirmish-v1', XP_REWARD=100;
 const screens=['titleScreen','lobbyScreen','matchScreen','battleUI','resultScreen'];
 let profile={level:1,xp:0,energy:30,matches:0}, saved=true;
 try {const p=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(p)profile={level:Math.max(1,Math.min(99,Math.floor(Number(p.level)||1))),xp:Math.max(0,Number(p.xp)||0),energy:Math.max(0,Math.min(30,Number(p.energy)||0)),matches:Math.max(0,Math.floor(Number(p.matches)||0))};}catch(e){saved=false;}
 function needXP(l=profile.level){return 60+l*10;}
 function save(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(profile));saved=true;}catch(e){saved=false;}}
 function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),2500);}
 const renderer=new TankRenderer($('battleCanvas'));
 const image=new Image();image.src=window.TANK_ATLAS_URL||'assets/tank-atlas.png?v=20261029.1';
 const rects=[[90,15,264,393],[533,15,265,393],[977,15,264,393],[1420,15,265,393],[90,456,264,397],[533,456,265,397]];
 let state='titleScreen',sim=null,aim=null,paused=false,settled=false,matchTimer=null,resultTimer=null,spectatorIndex=0;
 let joy={id:null,x:0,y:0},firePointers=new Set(),skillGesture=null,keys=new Set(),mouse={x:0,y:0,active:false},audioCtx=null,muted=false;
 function sound(type){try{if(muted||!audioCtx)return;const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type=type==='fire'?'square':'sine';o.frequency.setValueAtTime(type==='fire'?150:type==='hit'?82:type==='cast'?470:660,t);o.frequency.exponentialRampToValueAtTime(type==='fire'?40:140,t+.13);g.gain.setValueAtTime(type==='fire'?.025:.045,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);o.start(t);o.stop(t+.17);}catch(e){}}
 function enableSound(){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume();}catch(e){}}
 function show(id){screens.forEach(s=>$(s).classList.toggle('hidden',s!==id));state=id;$('battleCanvas').style.visibility=['battleUI','resultScreen'].includes(id)?'visible':'hidden';clearInput();if(id==='lobbyScreen')updateLobby();if(id==='battleUI')renderer.resize();}
 function clearInput(){keys.clear();firePointers.clear();joy={id:null,x:0,y:0};$('joyKnob').style.transform='';$('fireButton').classList.remove('firing');cancelAim();}
 function openModal(id){clearInput();$('modalShade').classList.remove('hidden');$$('.modal').forEach(el=>el.classList.toggle('hidden',el.id!==id));}
 function closeModal(){ $('modalShade').classList.add('hidden');$$('.modal').forEach(el=>el.classList.add('hidden'));}
 function updateLobby(){
  $('levelText').textContent=profile.level;$('energyText').textContent=profile.energy;$('xpText').textContent=`${profile.xp} / ${needXP()}`;$('xpFill').style.width=`${Math.min(100,profile.xp/needXP()*100)}%`;
  $('rankText').textContent=profile.level>=20?'装甲老兵':profile.level>=15?'支援车长':profile.level>=10?'坚盾车长':profile.level>=5?'炮火车长':'新晋车长';
  $('hpText').textContent=5+(profile.level>=20?Math.floor((profile.level-20)/5)+1:0);$('matchesText').textContent=profile.matches;
  $('saveStatus').textContent=saved?'进度保存在此浏览器':'浏览器未允许保存，本次进度保留在当前页面';
  $$('[data-unlock]').forEach(el=>{const open=profile.level>=Number(el.dataset.unlock);el.classList.toggle('unlocked',open);el.querySelector('em').textContent=open?'已解锁':'未解锁';});
  $('testLevel').value=String([1,5,10,15,20,25].reduce((a,b)=>b<=profile.level?b:a,1));
 }
 function tankPicture(canvas,index,angle=0,large=false){const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;const dpr=Math.min(window.devicePixelRatio||1,2);const w=Math.round(box.width*dpr),h=Math.round(box.height*dpr);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,box.width,box.height);if(!image.complete||!image.naturalWidth)return;ctx.imageSmoothingEnabled=false;const r=rects[index%6];const height=Math.min(box.height*(large?.85:.93),box.width*(large?1.14:1.45)),width=height*r[2]/r[3];ctx.translate(box.width/2,box.height/2);ctx.rotate(angle);ctx.drawImage(image,...r,-width/2,-height/2,width,height);}
 function beginMatch(){
  if(state!=='lobbyScreen')return;
  if(profile.energy<5){openModal('debugModal');toast('体力不足，点击“恢复体力”即可继续试玩');return;}
  profile.energy-=5;save();enableSound();sim=new TankCore({playerLevel:profile.level,seed:Math.floor(Math.random()*0xffffffff)});settled=false;spectatorIndex=0;
  ['allyLineup','enemyLineup'].forEach((id,team)=>{$(id).replaceChildren();sim.tanks.filter(t=>t.team===team).forEach((t,i)=>{const el=document.createElement('div');el.className='lineup-card';const c=document.createElement('canvas');c.dataset.skin=t.skin;el.append(c);const name=document.createElement('strong');name.textContent=t.isPlayer?'你 / 先锋':t.name.replace(/队友 · |敌军 · /g,'');el.append(name);const lv=document.createElement('span');lv.textContent=`LV.${t.level} · HP ${t.maxHp}`;el.append(lv);const txt=document.createElement('small');txt.textContent=t.level>=15?'炮火 / 护盾 / 工厂':t.level>=10?'炮火 / 护盾':t.level>=5?'炮火支援':'基础火力';el.append(txt);$(id).append(el);});});
  show('matchScreen');$('matchStatus').textContent='两队已就绪，正在进入战场…';
  document.querySelector('.match-progress i').style.animation='none';void document.querySelector('.match-progress').offsetWidth;document.querySelector('.match-progress i').style.animation='';
  clearTimeout(matchTimer);matchTimer=setTimeout(()=>{show('battleUI');paused=false;lastTime=performance.now();audioSeen=sim.sequence;updateHUD();pauseIfPortrait();},2300);
 }
 function settle(){if(settled||!sim?.result)return;settled=true;clearInput();const oldLevel=profile.level;profile.xp+=XP_REWARD;profile.matches++;while(profile.xp>=needXP()&&profile.level<99){profile.xp-=needXP();profile.level++;}save();const result=sim.result;
  $('resultTitle').textContent=result==='win'?'战斗胜利':result==='loss'?'战斗失利':'战斗平局';$('resultTitle').style.color=result==='win'?'var(--accent)':result==='loss'?'#eca494':'#b3d4ce';
  $('resultSubtitle').textContent=result==='win'?'敌方坦克已全部被击毁。':result==='loss'?'我方小队已全部被击毁，下次再战。':'双方坦克同时被击毁。';
  $('resultTime').textContent=formatTime(sim.elapsed);$('resultLevel').textContent=`LV.${profile.level}`;
  const unlocks=[['炮火支援',5],['装甲防护',10],['修理工厂',15]].filter(x=>oldLevel<x[1]&&profile.level>=x[1]);
  $('unlockNotice').textContent=unlocks.length?'新技能解锁：'+unlocks.map(x=>x[0]).join('、'):profile.level>oldLevel?`等级提升：LV.${oldLevel} → LV.${profile.level}`:`经验 ${profile.xp} / ${needXP()}，继续积累成长`;
  resultTimer=setTimeout(()=>show('resultScreen'),900);
 }
 function formatTime(sec){return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;}
 function updateHUD(){if(!sim)return;const p=sim.getPlayer();$('allyAlive').textContent=sim.tanks.filter(t=>t.team===0&&t.alive).length;$('enemyAlive').textContent=sim.tanks.filter(t=>t.team===1&&t.alive).length;$('battleTime').textContent=formatTime(sim.elapsed);$('playerHUDLevel').textContent=`LV.${p.level}`;$('playerHUDHP').textContent=`${p.hp} / ${p.maxHp}`;$('playerHUDHPFill').style.width=`${p.hp/p.maxHp*100}%`;
  $('squadStrip').innerHTML=sim.tanks.filter(t=>t.team===0).map(t=>`<div class="squad-mini ${t.alive?'':'dead'}"><b>${t.name}</b><span>LV.${t.level} · ${t.alive?`${t.hp}/${t.maxHp}`:'已击毁'}</span></div>`).join('');
  $('battleFeed').textContent=sim.events.slice(-2).join('　/　');
  Object.assign($('battleCanvas').dataset,{playerX:p.x.toFixed(1),playerY:p.y.toFixed(1),playerHp:String(p.hp),playerShield:p.shieldRemaining.toFixed(1),shots:String(sim.stats.shots),heals:String(sim.stats.heals),factories:String(sim.factories.length),elapsed:sim.elapsed.toFixed(1)});
  $('spectator').classList.toggle('hidden',p.alive||!!sim.result);
  document.querySelector('.movement-controls').style.opacity=p.alive?'1':'.35';document.querySelector('.combat-controls').style.opacity=p.alive?'1':'.35';
  $$('.ability').forEach(btn=>{const sk=btn.dataset.skill,locked=p.level<TankCore.SPECS[sk].level,cd=p.cd[sk];btn.classList.toggle('locked',locked||!p.alive);btn.classList.toggle('cooling',cd>0);btn.classList.toggle('aiming',aim?.skill===sk);btn.querySelector('.cooldown').textContent=cd>0?Math.ceil(cd):'';btn.querySelector('small').textContent=locked?`${TankCore.SPECS[sk].level}级解锁`:cd>0?'冷却中':sk==='shield'?'点击释放':'按住拖动';btn.setAttribute('aria-label',`${btn.querySelector('.ability-name').textContent} ${locked?'尚未解锁':cd>0?'冷却中':'可释放'}`);});
 }
 function available(skill){if(state!=='battleUI'||paused||!sim||sim.result)return false;const p=sim.getPlayer(),spec=TankCore.SPECS[skill];if(!p.alive){toast('坦克已被击毁，正在观战');return false;}if(p.level<spec.level){toast(`${spec.level} 级解锁此技能`);return false;}if(p.cd[skill]>0){toast(`技能冷却中，还需 ${Math.ceil(p.cd[skill])} 秒`);return false;}return true;}
 function castNow(skill,x,y){const result=sim.cast(skill,x,y);if(result.ok)sound('cast');else toast(result.reason);updateHUD();return result;}
 function cancelAim(){aim=null;skillGesture=null;$('cancelZone').classList.add('hidden');$('cancelZone').classList.remove('active');$('aimHint').classList.add('hidden');$('aimPad').classList.add('hidden');$$('.ability').forEach(b=>b.classList.remove('aiming'));}
 function startAim(skill){if(!available(skill))return false;cancelAim();if(skill==='shield'){castNow(skill);return false;}const p=sim.getPlayer(),range=TankCore.SPECS[skill].range;aim={skill,x:p.x+Math.cos(p.angle)*range*.55,y:p.y+Math.sin(p.angle)*range*.55,cancel:false};$('aimHint').textContent='拖动选择落点，松手释放';$('aimHint').classList.remove('hidden');$('cancelZone').classList.remove('hidden');$(skill+'Button').classList.add('aiming');return true;}
 function targetFromMouse(e){if(!aim||skillGesture)return;const pos=renderer.screenToWorld(e.clientX,e.clientY),p=sim.getPlayer(),range=TankCore.SPECS[aim.skill].range;const dx=pos.x-p.x,dy=pos.y-p.y,len=Math.hypot(dx,dy)||1;aim.x=p.x+dx*Math.min(1,range/len);aim.y=p.y+dy*Math.min(1,range/len);}
 function skillMove(e){if(!skillGesture||skillGesture.id!==e.pointerId||!aim)return;const g=skillGesture,p=sim.getPlayer(),dx=e.clientX-g.x,dy=e.clientY-g.y,len=Math.hypot(dx,dy),maxDrag=Math.min(130,window.innerHeight*.3),range=TankCore.SPECS[aim.skill].range;
  const cancelRect=$('cancelZone').getBoundingClientRect();const cx=cancelRect.left+cancelRect.width/2,cy=cancelRect.top+cancelRect.height/2;aim.cancel=Math.hypot(e.clientX-cx,e.clientY-cy)<cancelRect.width*.65;
  if(len>6){g.moved=true;g.dx=dx/len*Math.min(1,len/maxDrag)*range;g.dy=dy/len*Math.min(1,len/maxDrag)*range;aim.x=p.x+g.dx;aim.y=p.y+g.dy;}
  $('aimPad').classList.remove('hidden');$('aimPad').style.left=g.x+'px';$('aimPad').style.top=g.y+'px';$('aimPad').classList.toggle('cancelled',aim.cancel);$('aimKnob').style.transform=`translate(${dx/(len||1)*Math.min(40,len)}px,${dy/(len||1)*Math.min(40,len)}px)`;
  $('cancelZone').classList.toggle('active',aim.cancel);$('aimHint').textContent=aim.cancel?'松手取消释放':'松手释放 · 拖到取消区取消';
 }
 $$('.ability').forEach(btn=>{btn.addEventListener('pointerdown',e=>{e.preventDefault();if(e.button!==0)return;if(!available(btn.dataset.skill))return;if(btn.dataset.skill==='shield'){castNow('shield');return;}if(!startAim(btn.dataset.skill))return;btn.setPointerCapture(e.pointerId);skillGesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,dx:aim.x-sim.getPlayer().x,dy:aim.y-sim.getPlayer().y};});btn.addEventListener('pointermove',skillMove);btn.addEventListener('pointerup',e=>{if(!skillGesture||e.pointerId!==skillGesture.id)return;e.preventDefault();skillMove(e);const snapshot=aim;if(snapshot&&!snapshot.cancel)castNow(snapshot.skill,snapshot.x,snapshot.y);cancelAim();});btn.addEventListener('pointercancel',cancelAim);});
 function joyMove(e){if(joy.id!==e.pointerId)return;const r=$('joystick').getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,len=Math.hypot(dx,dy),max=r.width*.32;const strength=Math.min(1,len/max);joy.x=len>8?dx/(len||1)*strength:0;joy.y=len>8?dy/(len||1)*strength:0;$('joyKnob').style.transform=`translate(${dx/(len||1)*Math.min(max,len)}px,${dy/(len||1)*Math.min(max,len)}px)`;}
 $('joystick').addEventListener('pointerdown',e=>{if(state!=='battleUI'||paused||!sim?.getPlayer().alive)return;e.preventDefault();joy.id=e.pointerId;$('joystick').setPointerCapture(e.pointerId);joyMove(e);});$('joystick').addEventListener('pointermove',joyMove);['pointerup','pointercancel','lostpointercapture'].forEach(ev=>$('joystick').addEventListener(ev,e=>{if(joy.id===e.pointerId){joy={id:null,x:0,y:0};$('joyKnob').style.transform='';}}));
 $('fireButton').addEventListener('pointerdown',e=>{if(e.button!==0||state!=='battleUI'||paused)return;e.preventDefault();firePointers.add(e.pointerId);$('fireButton').setPointerCapture(e.pointerId);$('fireButton').classList.add('firing');});['pointerup','pointercancel','lostpointercapture'].forEach(ev=>$('fireButton').addEventListener(ev,e=>{firePointers.delete(e.pointerId);if(!firePointers.size)$('fireButton').classList.remove('firing');}));
 $('battleCanvas').addEventListener('pointermove',e=>{mouse={x:e.clientX,y:e.clientY,active:true};targetFromMouse(e);});$('battleCanvas').addEventListener('pointerdown',e=>{if(e.button===2){cancelAim();return;}if(aim&&!skillGesture&&state==='battleUI'&&!paused){targetFromMouse(e);const a=aim;castNow(a.skill,a.x,a.y);cancelAim();}});document.addEventListener('contextmenu',e=>{if(state==='battleUI'){e.preventDefault();cancelAim();}});
 function togglePause(){if(state!=='battleUI'||sim?.result)return;if(paused){paused=false;closeModal();lastTime=performance.now();}else{paused=true;openModal('pauseModal');}}
 window.addEventListener('keydown',e=>{if(e.target.matches('select,input'))return;const k=e.code;if(k==='Escape'){e.preventDefault();if(aim){cancelAim();return;}if(!$('modalShade').classList.contains('hidden')&&state!=='battleUI'){closeModal();return;}togglePause();return;}if(state!=='battleUI'||paused)return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space','KeyQ','KeyE','KeyR','Digit1','Digit2','Digit3'].includes(k))e.preventDefault();keys.add(k);if(e.repeat)return;const skill={KeyQ:'strike',Digit1:'strike',KeyE:'shield',Digit2:'shield',KeyR:'factory',Digit3:'factory'}[k];if(skill){if(startAim(skill)){aim.mode='keyboard';$('aimHint').textContent='点击战场选点释放 · 右键或 Esc 取消';if(mouse.active)targetFromMouse({clientX:mouse.x,clientY:mouse.y});}}});window.addEventListener('keyup',e=>keys.delete(e.code));
 window.addEventListener('blur',()=>{clearInput();if(state==='battleUI'&&!paused&&!sim?.result)togglePause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(state==='battleUI'&&!paused&&!sim?.result)togglePause();}});
 $('startButton').onclick=()=>{enableSound();show('lobbyScreen');};$('matchButton').onclick=beginMatch;$('returnLobby').onclick=()=>{clearTimeout(resultTimer);show('lobbyScreen');};$('debugButton').onclick=()=>openModal('debugModal');$('helpButton').onclick=()=>openModal('helpModal');$$('.close-modal,.close-help').forEach(b=>b.onclick=closeModal);
 $('restoreEnergy').onclick=()=>{profile.energy=30;save();updateLobby();toast('体力已恢复至 30 / 30');};$('applyTestLevel').onclick=()=>{profile.level=Number($('testLevel').value);profile.xp=0;save();updateLobby();toast(`测试等级已设为 ${profile.level} 级`);};$('pauseButton').onclick=togglePause;$('resumeButton').onclick=togglePause;$('quitButton').onclick=()=>{paused=false;closeModal();clearInput();sim=null;show('lobbyScreen');};$('switchSpectator').onclick=()=>spectatorIndex++;
 $('modalShade').addEventListener('pointerdown',e=>{if(e.target===$('modalShade')&&state!=='battleUI')closeModal();});
 let lastTime=performance.now(),hudTimer=0,audioSeen=0,previewTimer=0;
 function frame(now){const dt=Math.min(.05,Math.max(0,(now-lastTime)/1000));lastTime=now;
  if(state==='battleUI'||state==='resultScreen'){
   if(sim){if(state==='battleUI'&&!paused&&!sim.result){const mx=joy.id!==null?joy.x:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),my=joy.id!==null?joy.y:(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);sim.step(dt,{moveX:mx,moveY:my,fire:firePointers.size>0||keys.has('Space')});if(aim&&skillGesture){const p=sim.getPlayer();aim.x=p.x+skillGesture.dx;aim.y=p.y+skillGesture.dy;}if(!sim.getPlayer().alive&&aim)cancelAim();if(sim.result)settle();
    const fresh=sim.particles.filter(p=>p.id>audioSeen);if(fresh.some(p=>p.type==='muzzle'&&Math.hypot(p.x-sim.getPlayer().x,p.y-sim.getPlayer().y)<50))sound('fire');else if(fresh.some(p=>p.type==='explosion'&&Math.hypot(p.x-sim.getPlayer().x,p.y-sim.getPlayer().y)<600))sound('hit');audioSeen=sim.sequence;}
    let cameraTarget=sim.getPlayer();if(!cameraTarget.alive){const alive=sim.tanks.filter(t=>t.team===0&&t.alive);cameraTarget=alive[spectatorIndex%Math.max(1,alive.length)]||cameraTarget;}
    renderer.draw(sim,{dt:paused?0:dt,aim,cameraTarget});hudTimer+=dt;if(hudTimer>.1){hudTimer=0;updateHUD();}
   }
  }else{previewTimer+=dt;if(previewTimer>.05){previewTimer=0;if(state==='titleScreen')tankPicture($('titleTank'),0,-.48,true);if(state==='lobbyScreen')tankPicture($('lobbyTank'),0,.36,true);if(state==='matchScreen')$$('.lineup-card canvas').forEach(c=>tankPicture(c,Number(c.dataset.skin)));}}
  requestAnimationFrame(frame);
 }
 image.onload=()=>{tankPicture($('titleTank'),0,-.48,true);tankPicture($('lobbyTank'),0,.36,true);};
 function pauseIfPortrait(){if(window.matchMedia('(orientation:portrait) and (max-width:900px)').matches&&state==='battleUI'&&!paused&&!sim?.result)togglePause();}
 window.addEventListener('resize',()=>{renderer.resize();clearInput();pauseIfPortrait();});
 // Explicit inspection hooks used for deterministic local QA, never involved in normal play.
 window.tankDemo={get profile(){return {...profile};},get sim(){return sim;},get state(){return state;},get renderer(){return renderer;},get aim(){return aim;},get paused(){return paused;},get settled(){return settled;},beginMatch,restoreEnergy(){profile.energy=30;save();updateLobby();},setTestLevel(n){profile.level=Math.max(1,Math.min(99,n));profile.xp=0;save();updateLobby();},showLobby(){show('lobbyScreen');},finishForTest(result){if(!sim)return;sim.result=result;settle();},cast:(sk,x,y)=>castNow(sk,x,y),cancelAim};
 show('titleScreen');requestAnimationFrame(frame);
})();

