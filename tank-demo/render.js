/* Tank renderer. Local assets only; the battle model remains the source of truth. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const ATLAS = {
    cyan: [90,15,264,393], olive: [533,15,265,393], sand: [977,15,264,393],
    red: [1420,15,265,393], purple: [90,456,264,397], orange: [533,456,265,397],
    factory: [936,487,348,354], rock: [1357,487,369,365]
  };
  const FRIEND = '#7ce7d8', ENEMY = '#ff7d6e';
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const hash = (x,y,z=0) => {
    let n = (Math.imul(x+19,374761393) ^ Math.imul(y+7,668265263) ^ Math.imul(z+31,1274126177)) >>> 0;
    n = Math.imul(n ^ (n >>> 13),1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  function circle(c,x,y,r) { c.beginPath(); c.arc(x,y,r,0,TAU); }
  function rounded(c,x,y,w,h,r=5) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x,y,w,h,r);
    else c.rect(x,y,w,h);
  }
  function text(c,t,x,y,size=12,color='#eef5e9',align='center') {
    c.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    c.fillStyle=color; c.textAlign=align; c.textBaseline='middle'; c.fillText(t,x,y);
  }
  class TankRenderer {
    constructor(canvas) {
      this.canvas=canvas;
      this.ctx=canvas.getContext('2d',{alpha:false});
      this.camera={x:0,y:0}; this.zoom=1;
      this.width=1; this.height=1; this.dpr=1; this.time=0;
      this.mapCanvas=null; this.mapRef=null; this.miniCanvas=null; this.mapImageReady=false;
      this.cameraReady=false; this.lastSim=null; this.tracks=[]; this.lastPositions=new Map();
      this.atlas=new Image();
      this.atlas.onload=()=>{this.mapCanvas=null; this.mapImageReady=true;};
      this.atlas.src=root.TANK_ATLAS_URL || 'assets/tank-atlas.png?v=20261029.2';
      this.resize();
    }
    resize() {
      const r=this.canvas.getBoundingClientRect();
      const width=Math.max(1,Math.round(r.width || root.innerWidth || 1280));
      const height=Math.max(1,Math.round(r.height || root.innerHeight || 720));
      const dpr=Math.min(root.devicePixelRatio || 1,2);
      if(width!==this.width || height!==this.height || dpr!==this.dpr){
        this.width=width; this.height=height; this.dpr=dpr;
        this.canvas.width=Math.round(width*dpr); this.canvas.height=Math.round(height*dpr);
      }
      this.zoom=width<760 ? .78 : 1;
    }
    screenToWorld(clientX,clientY) {
      const r=this.canvas.getBoundingClientRect();
      return {x:(clientX-r.left-this.width/2)/this.zoom+this.camera.x,
        y:(clientY-r.top-this.height/2)/this.zoom+this.camera.y};
    }
    worldToScreen(x,y) {
      const r=this.canvas.getBoundingClientRect();
      return {x:(x-this.camera.x)*this.zoom+this.width/2+r.left,
        y:(y-this.camera.y)*this.zoom+this.height/2+r.top};
    }
    _sprite(c,name,x,y,width,angle=0,alpha=1) {
      const rect=ATLAS[name];
      if (!this.atlas.complete || !this.atlas.naturalWidth || !rect) return false;
      const h=width*rect[3]/rect[2], ay=name==='factory'||name==='rock' ? .5 : .64;
      c.save(); c.translate(x,y); c.rotate(angle); c.globalAlpha*=alpha; c.imageSmoothingEnabled=false;
      c.drawImage(this.atlas,...rect,-width*.5,-h*ay,width,h); c.restore(); return true;
    }
    _buildMap(sim) {
      const m=sim.map,T=m.tile,W=m.cols*T,H=m.rows*T;
      const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
      const c=canvas.getContext('2d');
      c.fillStyle='#5d7145'; c.fillRect(0,0,W,H);
      const cell=(x,y)=>x>=0&&y>=0&&x<m.cols&&y<m.rows?m.cells[y*m.cols+x]:1;
      for(let y=0;y<m.rows;y++) for(let x=0;x<m.cols;x++) {
        const type=cell(x,y), px=x*T,py=y*T;
        const n=hash(x,y);
        const green=['#617448','#62764a','#64784b','#607247','#5d7146'];
        c.fillStyle=green[Math.floor(n*green.length)]; c.fillRect(px,py,T,T);
        // Sparse, coherent grass texture without a visible grid.
        for(let k=0;k<18;k++) {
          const gx=px+hash(x,y,k+1)*T,gy=py+hash(x,y,k+42)*T;
          c.fillStyle=k%3===0?'rgba(183,183,113,.16)':'rgba(31,57,33,.12)';
          c.fillRect(gx,gy,k%2?2:4,1);
        }
        if(type!==0) continue;
        // A dirt track crosses the valley. It remains visual only on passable tiles.
        const curve=m.rows*.5+Math.sin(x*.17)*3.5;
        const road=Math.abs(y-curve)<1.1 || Math.abs(y-(m.rows*.24+Math.sin(x*.11)*1.6))<.55 || Math.abs(y-(m.rows*.77+Math.cos(x*.14)*1.4))<.55;
        if(road) {
          c.fillStyle='#938b5c'; c.globalAlpha=.7; c.fillRect(px,py,T,T); c.globalAlpha=1;
          for(let k=0;k<18;k++) {
            c.fillStyle=k%2?'#a49a6b':'#7b7b53';
            c.fillRect(px+hash(x,y,k+50)*T,py+hash(x,y,k+88)*T,2+hash(k,x,y)*4,1.4);
          }
          c.strokeStyle='rgba(65,65,43,.14)'; c.lineWidth=2;
          c.beginPath(); c.moveTo(px,py+T*.3);c.lineTo(px+T,py+T*.3+Math.sin(x)*2);c.stroke();
        } else if(n>.8) {
          // Small grass tufts read as ground cover, never as solid obstacles.
          for(let k=0;k<3;k++){
            const gx=px+hash(x,y,k+12)*T, gy=py+hash(x,y,k+15)*T;
            c.strokeStyle='rgba(55,81,40,.5)';c.lineWidth=1.3;
            c.beginPath();c.moveTo(gx-2,gy);c.lineTo(gx-3,gy-4);c.moveTo(gx,gy);c.lineTo(gx+1,gy-6);c.moveTo(gx+2,gy);c.lineTo(gx+4,gy-3);c.stroke();
          }
        }
      }
      // Water is tiled to the exact collider footprint with a visible bank.
      for(let y=0;y<m.rows;y++)for(let x=0;x<m.cols;x++)if(cell(x,y)===2){
        const px=x*T,py=y*T;
        c.fillStyle='#416f72';c.fillRect(px,py,T,T);
        c.fillStyle='rgba(33,84,91,.32)';c.fillRect(px+3,py+3,T-6,T-6);
        for(let k=0;k<6;k++) {
          const gx=px+hash(x,y,k+12)*(T-10),gy=py+hash(x,y,k+92)*T;
          c.fillStyle='rgba(156,203,181,.21)';c.fillRect(gx,gy,7+hash(x,y,k+5)*12,1);
        }
        const sides=[[x,y-1,px,py,T,5],[x,y+1,px,py+T-5,T,5],[x-1,y,px,py,5,T],[x+1,y,px+T-5,py,5,T]];
        for(const [nx,ny,sx,sy,sw,sh] of sides)if(cell(nx,ny)!==2){
          c.fillStyle='#a7a17a';c.fillRect(sx,sy,sw,sh);
          c.fillStyle='rgba(193,217,178,.5)';
          if(sw===T)c.fillRect(sx,sy+(ny<y?4:0),sw,1);else c.fillRect(sx+(nx<x?4:0),sy,1,sh);
        }
      }
      // Rock bed fills each blocked tile; the authored rocks sit over the bed.
      for(let y=0;y<m.rows;y++)for(let x=0;x<m.cols;x++)if(cell(x,y)===1){
        const px=x*T,py=y*T;
        c.fillStyle='#5b6550';c.fillRect(px,py,T,T);
        if(cell(x,y+1)!==1){c.fillStyle='rgba(25,35,24,.28)';c.fillRect(px,py+T-7,T,7);}
        if(cell(x-1,y)!==1){c.fillStyle='#788366';c.fillRect(px,py,4,T);}
        if(cell(x,y-1)!==1){c.fillStyle='#8a8a6a';c.fillRect(px,py,T,3);}
        if(!this._sprite(c,'rock',px+T/2,py+T/2,T*1.05,(Math.floor(hash(x,y)*4))*Math.PI/2)){
          c.fillStyle='#858673'; c.beginPath(); c.moveTo(px+4,py+8);c.lineTo(px+T*.6,py+2);c.lineTo(px+T-2,py+T*.5);c.lineTo(px+T*.7,py+T-3);c.lineTo(px+2,py+T*.8);c.closePath();c.fill();
        }
      }
      // Spawn-zone ground paint is a landmark rather than a collision object.
      for(const team of [0,1]){
        const sx=team===0?T*6:T*(m.cols-6), sy=T*(m.rows/2);
        c.strokeStyle=team===0?'rgba(139,220,183,.35)':'rgba(227,157,111,.32)';c.lineWidth=3;c.setLineDash([12,10]);
        circle(c,sx,sy,125);c.stroke();c.setLineDash([]);
        text(c,team===0?'西部集结区':'东部集结区',sx,sy+155,13,team===0?'#b7d9b0':'#d6b68a');
      }
      this.mapCanvas=canvas;this.mapRef=m;
      this.miniCanvas=document.createElement('canvas');this.miniCanvas.width=m.cols;this.miniCanvas.height=m.rows;
      const mc=this.miniCanvas.getContext('2d');
      for(let y=0;y<m.rows;y++)for(let x=0;x<m.cols;x++){
        mc.fillStyle=['#65764e','#a49b79','#487e85'][cell(x,y)];mc.fillRect(x,y,1,1);
      }
    }
    _updateCamera(sim,opt) {
      const target=opt.cameraTarget || sim.getPlayer?.() || sim.tanks[0];
      if(!target)return;
      const halfW=this.width/(2*this.zoom),halfH=this.height/(2*this.zoom);
      const W=sim.worldW||sim.map.cols*sim.map.tile,H=sim.worldH||sim.map.rows*sim.map.tile;
      const x=halfW*2>=W?W/2:clamp(target.x,halfW,W-halfW);
      const y=halfH*2>=H?H/2:clamp(target.y,halfH,H-halfH);
      if(!this.cameraReady){this.camera.x=x;this.camera.y=y;this.cameraReady=true;}
      const a=1-Math.exp(-Math.min(opt.dt||1/60,.1)*9);
      this.camera.x+=(x-this.camera.x)*a;this.camera.y+=(y-this.camera.y)*a;
    }
    _track(t) {
      const prev=this.lastPositions.get(t.id);
      if(!prev||Math.hypot(t.x-prev.x,t.y-prev.y)>12){
        if(prev&&t.alive)this.tracks.push({x:t.x,y:t.y,angle:t.angle,created:this.time});
        this.lastPositions.set(t.id,{x:t.x,y:t.y});
      }
    }
    _factory(c,f) {
      if(f.alive===false || f.hp<=0)return;
      const color=f.team===0?FRIEND:ENEMY,r=f.radius||f.healRadius||140;
      c.fillStyle=f.team===0?'rgba(114,222,133,.065)':'rgba(236,123,95,.045)';circle(c,f.x,f.y,r);c.fill();
      c.strokeStyle=f.team===0?'rgba(121,231,151,.5)':'rgba(255,137,115,.4)';c.lineWidth=1.5;
      c.setLineDash([7,7]);c.lineDashOffset=-this.time*7;circle(c,f.x,f.y,r);c.stroke();c.setLineDash([]);
      c.fillStyle='rgba(15,25,17,.3)';circle(c,f.x+3,f.y+6,29);c.fill();
      if(!this._sprite(c,'factory',f.x,f.y,62)){
        c.fillStyle='#d8ddbf';c.fillRect(f.x-24,f.y-24,48,48);c.fillStyle='#69ae5b';c.fillRect(f.x-14,f.y-5,28,10);c.fillRect(f.x-5,f.y-14,10,28);
      }
      c.fillStyle='#192e24';rounded(c,f.x-24,f.y-43,48,7,2);c.fill();c.fillStyle=color;c.fillRect(f.x-22,f.y-41,44*clamp(f.hp||1,0,1),3);
      text(c,'维修站 · 1 HP',f.x,f.y+42,10,'#e2efda');
    }
    _tank(c,t,index) {
      const color=t.team===0?FRIEND:ENEMY;
      const names=['cyan','olive','sand','red','purple','orange'];
      const skin=typeof t.skin==='number'?names[t.skin%names.length]:(t.skin || names[t.isPlayer?0:t.team===0?(index%2+1):(index%3+3)]);
      const width=44;
      if(!t.alive){
        c.save();c.globalAlpha=.68;c.filter='grayscale(1) brightness(.35)';this._sprite(c,skin,t.x,t.y,width,t.angle+Math.PI/2);c.restore();
        c.fillStyle='rgba(22,24,18,.42)';circle(c,t.x,t.y,26);c.fill();
        c.strokeStyle='rgba(188,167,124,.35)';c.lineWidth=2;c.beginPath();c.moveTo(t.x-6,t.y-6);c.lineTo(t.x+6,t.y+6);c.moveTo(t.x+6,t.y-6);c.lineTo(t.x-6,t.y+6);c.stroke();
        return;
      }
      this._track(t);
      c.fillStyle='rgba(18,28,20,.27)';c.beginPath();c.ellipse(t.x+3,t.y+7,24,20,0,0,TAU);c.fill();
      if(t.isPlayer){
        c.strokeStyle='rgba(147,241,208,.8)';c.lineWidth=1.5;circle(c,t.x,t.y,30);c.stroke();
        c.save();c.translate(t.x,t.y);c.rotate(t.angle);c.fillStyle='#b1f2cb';c.beginPath();c.moveTo(47,0);c.lineTo(40,-4);c.lineTo(40,4);c.closePath();c.fill();c.restore();
      }
      if(!this._sprite(c,skin,t.x,t.y,width,t.angle+Math.PI/2)){
        c.save();c.translate(t.x,t.y);c.rotate(t.angle);c.fillStyle=color;c.fillRect(-19,-15,38,30);c.fillStyle='#263f37';c.fillRect(-19,-21,38,7);c.fillRect(-19,14,38,7);c.fillStyle=color;c.fillRect(0,-4,37,8);c.restore();
      }
      const shield=t.shieldRemaining||0;
      if(shield>0){
        const pulse=.85+.15*Math.sin(this.time*5);
        const g=c.createRadialGradient(t.x,t.y,18,t.x,t.y,38);
        g.addColorStop(0,'rgba(114,220,255,0)');g.addColorStop(.82,'rgba(131,213,255,.07)');g.addColorStop(1,'rgba(151,231,255,.4)');
        c.fillStyle=g;circle(c,t.x,t.y,37*pulse);c.fill();c.lineWidth=2;c.strokeStyle='rgba(174,236,255,.8)';circle(c,t.x,t.y,37*pulse);c.stroke();
        c.strokeStyle='rgba(217,253,255,.95)';c.beginPath();c.arc(t.x,t.y,33,-Math.PI*.85,-Math.PI*.35);c.stroke();
      }
    }
    _layoutTankLabels(tanks) {
      const placed=[];
      // Camera translation and zoom preserve this ordering and overlap relation.
      const ordered=tanks.filter(t=>t.alive).slice().sort((a,b)=>a.y-b.y || a.x-b.x || String(a.id).localeCompare(String(b.id)));
      for(const t of ordered){
        let by=t.y-58;
        const overlaps=()=>placed.some(q=>Math.abs(t.x-q.t.x)<63 && by-14<q.by+16 && by+16>q.by-14);
        // Move only crowded labels; isolated labels keep their original placement.
        while(overlaps())by-=23;
        placed.push({t,by});
      }
      return placed;
    }
    _tankLabel(c,t,by) {
      const color=t.team===0?FRIEND:ENEMY,bx=t.x-27;
      c.fillStyle='rgba(11,24,22,.84)';rounded(c,bx-3,by-14,60,27,3);c.fill();
      const label=t.isPlayer?'你':(t.name|| (t.team===0?'队友':'敌军')).replace(/^(队友|敌军)\s*[·・]\s*/, '');
      text(c,`${label}  Lv.${t.level}`,t.x,by-6,9.5,t.isPlayer?'#e1ffdf':color);
      c.fillStyle='#293630';c.fillRect(bx,by+3,54,6);
      c.fillStyle=t.hp/t.maxHp<.3?'#ffc16a':color;c.fillRect(bx,by+3,54*clamp(t.hp/t.maxHp,0,1),6);
      if(t.maxHp<15){c.strokeStyle='rgba(17,29,25,.7)';c.lineWidth=1;for(let i=1;i<t.maxHp;i++){c.beginPath();c.moveTo(bx+54*i/t.maxHp,by+3);c.lineTo(bx+54*i/t.maxHp,by+9);c.stroke();}}
      text(c,`${Math.ceil(t.hp)}/${t.maxHp}`,t.x,t.y+33,10,'#f5f1cf');
    }
    _strike(c,s) {
      const delay=s.remaining ?? s.delay ?? s.timer ?? s.timeLeft ?? .9;
      const duration=s.duration || .9;
      const progress=clamp(1-delay/duration,0,1);
      const r=s.radius||95,color=s.team===0?'#d5e8a1':'#ff9b78';
      c.fillStyle=s.team===0?'rgba(230,210,100,.09)':'rgba(239,111,78,.12)';circle(c,s.x,s.y,r);c.fill();
      c.strokeStyle=color;c.lineWidth=2;c.setLineDash([7,5]);circle(c,s.x,s.y,r);c.stroke();c.setLineDash([]);
      c.lineWidth=3;circle(c,s.x,s.y,8+progress*(r-8));c.stroke();
      c.beginPath();c.moveTo(s.x-12,s.y);c.lineTo(s.x+12,s.y);c.moveTo(s.x,s.y-12);c.lineTo(s.x,s.y+12);c.stroke();
      // Incoming projectile is a vertical screen-space descent to the marked ground point.
      const h=(1-progress)*230;
      c.save();c.translate(s.x,s.y-h);c.fillStyle='#f2dc9b';c.fillRect(-3,-14,6,17);c.fillStyle='#ed9158';c.beginPath();c.moveTo(-3,-15);c.lineTo(0,-30-8*Math.sin(this.time*60));c.lineTo(3,-15);c.fill();c.restore();
    }
    _particle(c,p) {
      const age=p.age||0,life=p.life||.5,q=clamp(age/life,0,1),a=1-q;
      c.save();c.globalAlpha=a;
      if(p.type==='heal'){
        c.fillStyle='#91ffc1';
        for(let i=0;i<5;i++){
          const theta=i*TAU/5+age*2,rr=18+q*12,x=p.x+Math.cos(theta)*rr,y=p.y+Math.sin(theta)*rr-age*23;
          c.fillRect(x-2,y-5,4,10);c.fillRect(x-5,y-2,10,4);
        }
        c.shadowColor='#2ded97';c.shadowBlur=7;text(c,p.text||'HP++',p.x,p.y-23-q*26,15,'#b6ffd1');
      }else if(p.type==='explosion'||p.type==='death'){
        const r=(p.radius|| (p.type==='death'?45:70))*(.2+q);
        const g=c.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
        g.addColorStop(0,'rgba(255,244,177,.8)');g.addColorStop(.3,'rgba(249,167,69,.7)');g.addColorStop(.65,'rgba(174,99,48,.5)');g.addColorStop(1,'rgba(64,52,35,0)');
        c.fillStyle=g;circle(c,p.x,p.y,r);c.fill();
        c.strokeStyle='#ffe3aa';c.lineWidth=2*(1-q);circle(c,p.x,p.y,r*.8);c.stroke();
        for(let i=0;i<9;i++){const theta=i*2.4;c.fillStyle=i%2?'#ffd793':'#b1a083';c.fillRect(p.x+Math.cos(theta)*r*.8,p.y+Math.sin(theta)*r*.8,3,3);}
      }else if(p.type==='shield'){
        c.strokeStyle='#c5f5ff';c.lineWidth=3;circle(c,p.x,p.y,25+q*30);c.stroke();
      }else if(p.type==='muzzle'){
        c.fillStyle='#fff4b5';circle(c,p.x,p.y,3+5*(1-q));c.fill();
      }else{
        c.strokeStyle='#ffdc8c';c.lineWidth=2;
        for(let i=0;i<5;i++){const t=i*TAU/5;c.beginPath();c.moveTo(p.x+Math.cos(t)*q*6,p.y+Math.sin(t)*q*6);c.lineTo(p.x+Math.cos(t)*(7+q*12),p.y+Math.sin(t)*(7+q*12));c.stroke();}
        if(p.text)text(c,p.text,p.x,p.y-18-q*20,12,'#ffe7a0');
      }
      c.restore();
    }
    _aim(c,sim,aim) {
      const p=sim.getPlayer?.()||sim.tanks.find(t=>t.isPlayer);
      if(!p?.alive)return;
      const range=aim.skill==='strike'?550:360,radius=aim.skill==='strike'?95:140;
      let valid=Math.hypot(aim.x-p.x,aim.y-p.y)<=range+.5 && !aim.cancel && aim.x>=0 && aim.y>=0 && aim.x<=sim.worldW && aim.y<=sim.worldH;
      if(aim.skill==='factory'&&sim.canStand)valid=valid&&sim.canStand(aim.x,aim.y,24);
      const color=valid?'#8ce7ef':'#ff8b76';
      c.fillStyle='rgba(122,216,235,.018)';circle(c,p.x,p.y,range);c.fill();
      c.strokeStyle=aim.cancel?'rgba(255,139,118,.5)':'rgba(130,219,236,.55)';c.lineWidth=1.5;c.setLineDash([10,9]);circle(c,p.x,p.y,range);c.stroke();c.setLineDash([]);
      c.strokeStyle=color;c.lineWidth=2;circle(c,aim.x,aim.y,radius);c.stroke();
      c.fillStyle=valid?'rgba(115,219,239,.10)':'rgba(246,111,93,.08)';c.fill();
      c.setLineDash([3,6]);c.lineWidth=1;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(aim.x,aim.y);c.stroke();c.setLineDash([]);
      const theta=Math.atan2(aim.y-p.y,aim.x-p.x),tipX=aim.x-Math.cos(theta)*(radius+8),tipY=aim.y-Math.sin(theta)*(radius+8);
      if(Math.hypot(aim.x-p.x,aim.y-p.y)>radius+20){c.fillStyle=color;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(tipX-Math.cos(theta-.45)*13,tipY-Math.sin(theta-.45)*13);c.lineTo(tipX-Math.cos(theta+.45)*13,tipY-Math.sin(theta+.45)*13);c.closePath();c.fill();}
      if(aim.skill==='factory')this._sprite(c,'factory',aim.x,aim.y,60,0,.55);
      else {c.beginPath();c.moveTo(aim.x-14,aim.y);c.lineTo(aim.x+14,aim.y);c.moveTo(aim.x,aim.y-14);c.lineTo(aim.x,aim.y+14);c.stroke();}
      c.fillStyle='rgba(15,30,23,.85)';rounded(c,aim.x-76,aim.y+radius+10,152,24,4);c.fill();
      text(c,aim.cancel?'松开取消':valid?(aim.mode==='keyboard'?'点击落点施放':'松开施放 · Esc 取消'):'落点不可用',aim.x,aim.y+radius+22,11,color);
    }
    _minimap(sim) {
      if(!this.miniCanvas)return;
      const c=this.ctx, compact=this.height<500, small=this.width<760 || compact;
      const w=small?118:156,h=w*sim.map.rows/sim.map.cols,x=this.width-w-18,y=compact?82:small?84:100;
      c.fillStyle='rgba(13,28,24,.83)';rounded(c,x-(compact?6:7),y-(compact?17:23),w+(compact?12:14),h+(compact?25:43),8);c.fill();
      text(c,'战术地图',x+3,y-(compact?8:11),compact?9:10,'#bac9ad','left');text(c,'N ↑',x+w-1,y-(compact?8:11),9,'#bac9ad','right');
      c.imageSmoothingEnabled=false;c.drawImage(this.miniCanvas,x,y,w,h);
      c.strokeStyle='rgba(208,219,177,.25)';c.lineWidth=1;c.strokeRect(x,y,w,h);
      const W=sim.worldW||sim.map.cols*sim.map.tile,H=sim.worldH||sim.map.rows*sim.map.tile;
      c.save();c.beginPath();c.rect(x,y,w,h);c.clip();
      c.strokeStyle='rgba(237,246,213,.7)';c.lineWidth=1;
      c.strokeRect(x+(this.camera.x-this.width/this.zoom/2)/W*w,y+(this.camera.y-this.height/this.zoom/2)/H*h,this.width/this.zoom/W*w,this.height/this.zoom/H*h);
      for(const f of sim.factories||[])if(f.alive!==false&&f.hp>0){c.fillStyle=f.team===0?'#a2f4ab':'#fd947a';c.fillRect(x+f.x/W*w-2,y+f.y/H*h-2,4,4);}
      for(const t of sim.tanks)if(t.alive){c.fillStyle=t.isPlayer?'#ffffff':t.team===0?FRIEND:ENEMY;circle(c,x+t.x/W*w,y+t.y/H*h,t.isPlayer?3:2.3);c.fill();}
      c.restore();
      if(!compact)text(c,'● 我方   ● 敌方',x+w/2,y+h+11,9,'#ccd8bd');
    }
    draw(sim,opt={}) {
      this.resize();if(!sim)return;
      if(this.lastSim!==sim){this.lastSim=sim;this.cameraReady=false;this.tracks=[];this.lastPositions.clear();}
      this.time=sim.elapsed || opt.elapsed || 0;
      if(!this.mapCanvas||this.mapRef!==sim.map)this._buildMap(sim);
      this._updateCamera(sim,opt);
      const c=this.ctx,W=this.width,H=this.height,z=this.zoom;
      c.setTransform(this.dpr,0,0,this.dpr,0,0);c.globalAlpha=1;c.filter='none';c.fillStyle='#243929';c.fillRect(0,0,W,H);
      c.save();c.translate(W/2,H/2);c.scale(z,z);c.translate(-this.camera.x,-this.camera.y);
      c.imageSmoothingEnabled=false;c.drawImage(this.mapCanvas,0,0);
      // Only shimmer visible water tiles, leaving the collision boundary readable.
      const m=sim.map,T=m.tile,left=this.camera.x-W/z/2,top=this.camera.y-H/z/2;
      const x0=Math.max(0,Math.floor(left/T)),x1=Math.min(m.cols,Math.ceil((left+W/z)/T));
      const y0=Math.max(0,Math.floor(top/T)),y1=Math.min(m.rows,Math.ceil((top+H/z)/T));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(m.cells[y*m.cols+x]===2){
        c.fillStyle=`rgba(183,225,211,${.06+.06*Math.sin(this.time*1.8+x*.7+y*.4)})`;
        c.fillRect(x*T+10,y*T+16+Math.sin(this.time+x)*3,15,1);
      }
      if(this.tracks.length>1000)this.tracks.splice(0,this.tracks.length-1000);
      for(const tr of this.tracks){if(this.time-tr.created>35)continue;c.save();c.globalAlpha=.14*(1-(this.time-tr.created)/35);c.translate(tr.x,tr.y);c.rotate(tr.angle);c.fillStyle='#263d2a';c.fillRect(-7,-18,11,5);c.fillRect(-7,13,11,5);c.restore();}
      for(const f of sim.factories||[])this._factory(c,f);
      for(const s of sim.strikes||[])this._strike(c,s);
      const tanks=sim.tanks.slice().sort((a,b)=>(a.alive===b.alive?a.y-b.y:a.alive?1:-1));
      tanks.forEach((t,i)=>this._tank(c,t,sim.tanks.indexOf(t)));
      const labels=this._layoutTankLabels(tanks);
      for(const {t,by} of labels)if(by<t.y-59){
        c.strokeStyle=t.team===0?'rgba(150,218,198,.5)':'rgba(237,162,143,.5)';c.lineWidth=1;
        c.beginPath();c.moveTo(t.x,t.y-29);c.lineTo(t.x,by+13);c.stroke();
      }
      for(const {t,by} of labels)this._tankLabel(c,t,by);
      for(const b of sim.bullets||[]){
        const angle=b.angle??Math.atan2(b.vy||0,b.vx||1);
        c.strokeStyle=b.team===0?'#ffedb0':'#ffb27d';c.lineWidth=3;c.lineCap='round';
        c.beginPath();c.moveTo(b.x-Math.cos(angle)*12,b.y-Math.sin(angle)*12);c.lineTo(b.x,b.y);c.stroke();
        c.fillStyle='#fff8db';circle(c,b.x,b.y,2.5);c.fill();c.lineCap='butt';
      }
      for(const p of sim.particles||[])this._particle(c,p);
      if(opt.aim)this._aim(c,sim,opt.aim);
      c.restore();
      // Restrained edge vignette keeps the center of battle legible.
      const g=c.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.max(W,H)*.7);
      g.addColorStop(0,'rgba(12,26,20,0)');g.addColorStop(1,'rgba(12,26,20,.2)');c.fillStyle=g;c.fillRect(0,0,W,H);
      this._minimap(sim);
    }
    drawTankPreview(canvas,color='cyan') {
      const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
      c.clearRect(0,0,w,h);this._sprite(c,color,w/2,h*.56,Math.min(w*.6,h*.53),-.3);
    }
  }
  root.TankRenderer=TankRenderer;
})(typeof window!=='undefined'?window:globalThis);
