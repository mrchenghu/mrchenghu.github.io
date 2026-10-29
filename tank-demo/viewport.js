(function(){
 'use strict';
 const app=document.getElementById('app');
 const view=window.TankViewport={
  rotated:false,width:1,height:1,
  point(x,y){const r=app.getBoundingClientRect();return this.rotated?{x:y-r.top,y:r.right-x}:{x:x-r.left,y:y-r.top};},
  client(x,y){const r=app.getBoundingClientRect();return this.rotated?{x:r.right-y,y:r.top+x}:{x:r.left+x,y:r.top+y};},
  vector(x,y){return this.rotated?{x:y,y:-x}:{x,y};},
  update(){
   const v=window.visualViewport,w=Math.round(v?v.width:innerWidth),h=Math.round(v?v.height:innerHeight);
   this.rotated=w<h&&w<=900;this.width=this.rotated?h:w;this.height=this.rotated?w:h;
   app.style.width=this.width+'px';app.style.height=this.height+'px';
   app.style.left=(v?v.offsetLeft:0)+(this.rotated?w:0)+'px';app.style.top=(v?v.offsetTop:0)+'px';
   app.style.transform=this.rotated?'rotate(90deg)':'none';
   app.style.setProperty('--game-width',this.width+'px');app.style.setProperty('--game-height',this.height+'px');
   app.classList.toggle('layout-medium',this.width<=1100);
   app.classList.toggle('layout-short',this.height<=650);
   app.classList.toggle('layout-compact',this.height<=460&&this.width>=this.height);
  }
 };
 view.update();
 window.addEventListener('resize',()=>view.update());
 if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{view.update();window.dispatchEvent(new Event('tankviewportchange'));});
})();
