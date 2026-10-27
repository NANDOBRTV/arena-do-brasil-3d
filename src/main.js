import * as THREE from "three";
import {createInitialState,applyDamage,recordVote,getWinner,ROUND_SECONDS} from "./game.js";
import "./style.css";
const $=id=>document.getElementById(id);let state=createInitialState(),timer=null,audio=false,shield={green:0,blue:0};
const scene=new THREE.Scene();scene.background=new THREE.Color("#10172b");scene.fog=new THREE.Fog("#10172b",18,42);
const camera=new THREE.PerspectiveCamera(48,1,.1,100);camera.position.set(0,7,15);camera.lookAt(0,1,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;$("arena").prepend(renderer.domElement);$("three-fallback").remove();
scene.add(new THREE.HemisphereLight("#c7e5ff","#14203b",2));
const key=new THREE.DirectionalLight("#fff0d6",3);key.position.set(3,10,6);key.castShadow=true;scene.add(key);
const floor=new THREE.Mesh(new THREE.CylinderGeometry(7,7,.35,64),new THREE.MeshStandardMaterial({color:"#293550",metalness:.3,roughness:.65}));floor.position.y=-.2;floor.receiveShadow=true;scene.add(floor);
const ring=new THREE.Mesh(new THREE.TorusGeometry(6.5,.09,12,100),new THREE.MeshStandardMaterial({color:"#e8bd63",emissive:"#674316",emissiveIntensity:.4}));ring.rotation.x=Math.PI/2;ring.position.y=.02;scene.add(ring);
for(let i=0;i<24;i++){const a=i/24*Math.PI*2;const pillar=new THREE.Mesh(new THREE.BoxGeometry(.28,1.5,.28),new THREE.MeshStandardMaterial({color:i%2?"#2f496d":"#c6a45c",emissive:i%2?"#132a54":"#5a3610",emissiveIntensity:.4}));pillar.position.set(Math.cos(a)*7.8,.55,Math.sin(a)*7.8);scene.add(pillar);}
function fighter(color,x){
 const g=new THREE.Group(),teamMat=new THREE.MeshStandardMaterial({color,roughness:.34,metalness:.12}),skin=new THREE.MeshStandardMaterial({color:"#c98765",roughness:.7}),dark=new THREE.MeshStandardMaterial({color:"#171e2d",roughness:.6}),gold=new THREE.MeshStandardMaterial({color:"#f2c86b",metalness:.65,roughness:.28});
 const add=(geo,mat,pos,rot)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);if(rot)m.rotation.set(...rot);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;};
 // Silhueta de lutador com uniforme, luvas, botas e detalhes de rosto.
 add(new THREE.CapsuleGeometry(.48,.78,6,14),teamMat,[0,1.38,0]);
 add(new THREE.SphereGeometry(.29,16,12),teamMat,[0,1.78,0]);
 add(new THREE.SphereGeometry(.39,24,18),skin,[0,2.26,0]);
 add(new THREE.SphereGeometry(.405,24,12,0,Math.PI*2,0,Math.PI*.48),dark,[0,2.43,-.015]);
 add(new THREE.BoxGeometry(.48,.08,.12),dark,[0,2.31,.345]);
 for(const side of [-1,1]){
  add(new THREE.SphereGeometry(.055,10,8),gold,[side*.145,2.32,.355]);
  add(new THREE.CapsuleGeometry(.145,.52,5,10),skin,[side*.61,1.48,0],[0,0,side*-.35]);
  add(new THREE.SphereGeometry(.19,14,12),teamMat,[side*.78,1.16,.04]);
  add(new THREE.CapsuleGeometry(.18,.52,5,10),dark,[side*.23,.55,0],[0,0,side*.07]);
  add(new THREE.BoxGeometry(.31,.16,.48),teamMat,[side*.23,.22,.09]);
  add(new THREE.BoxGeometry(.34,.13,.5),dark,[side*.23,.12,.1]);
 }
 add(new THREE.BoxGeometry(.72,.13,.5),gold,[0,1.03,.015]);
 add(new THREE.BoxGeometry(.18,.18,.06),dark,[0,1.03,.28]);
 // Ombre de contato e emblema frontal.
 add(new THREE.BoxGeometry(.24,.25,.045),gold,[0,1.55,.48]);
 g.position.x=x;g.userData.baseX=x;g.userData.action=0;g.userData.hit=0;scene.add(g);return g;
}
const green=fighter("#21b875",-2.2),blue=fighter("#428bff",2.2);blue.rotation.y=Math.PI;
const fighters={green,blue};
function animateStrike(team,target){
 const attacker=fighters[team],defender=fighters[target];
 attacker.userData.action=.42;defender.userData.hit=.32;
 burst(team==="green"?"#4effb0":"#73b5ff",18);sound(team==="green"?170:145);
}
function addArenaLights(){
 // Arquibancadas em anéis e refletores para dar profundidade ao estádio.
 for(let row=0;row<3;row++)for(let i=0;i<48;i++){
  const a=i/48*Math.PI*2,r=8.9+row*.62,y=.65+row*.48;
  const light=new THREE.Mesh(new THREE.BoxGeometry(.18,.22,.16),new THREE.MeshStandardMaterial({color:i%4===0?"#f5d58b":i%2?"#537db7":"#354767",emissive:i%4===0?"#6a4d1c":"#101c36",emissiveIntensity:.45}));
  light.position.set(Math.cos(a)*r,y,Math.sin(a)*r);light.lookAt(0,y,0);scene.add(light);
 }
 for(const [x,c] of [[-6,"#21b875"],[6,"#428bff"]]){
  const lamp=new THREE.SpotLight(c,95,24,Math.PI/5,.55,1.4);lamp.position.set(x,9,3);lamp.target.position.set(x*.35,0,0);scene.add(lamp,lamp.target);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),new THREE.MeshBasicMaterial({color:c}));bulb.position.copy(lamp.position);scene.add(bulb);
 }
}
addArenaLights();
const particles=[];
function burst(color="#ffd166",n=28){for(let i=0;i<n;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.055,6,6),new THREE.MeshBasicMaterial({color}));m.position.set((Math.random()-.5)*3,Math.random()*3+.5,(Math.random()-.5)*2);scene.add(m);particles.push({m,v:new THREE.Vector3((Math.random()-.5)*.12,Math.random()*.13,(Math.random()-.5)*.12),life:45+Math.random()*25});}}
function sound(freq=220){if(!audio)return;try{const ctx=new AudioContext(),o=ctx.createOscillator(),gain=ctx.createGain();o.frequency.value=freq;o.type="triangle";gain.gain.value=.045;o.connect(gain);gain.connect(ctx.destination);o.start();gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.22);o.stop(ctx.currentTime+.23);o.onended=()=>ctx.close();}catch{}}
function log(msg){const feed=$("event-feed");if(feed.querySelector(".empty-state"))feed.innerHTML="";const row=document.createElement("div");row.className="event-item";row.textContent=msg;feed.prepend(row);while(feed.children.length>8)feed.lastChild.remove();$("event-count").textContent=String(Number($("event-count").textContent)+1);}
function renderState(){for(const t of ["green","blue"]){$(t+"-health").style.width=(state[t].health/600*100)+"%";$(t+"-health-text").textContent=state[t].health+" / 600 energia";$(t+"-score").textContent=state[t].score;}$("round-number").textContent=String(state.round).padStart(2,"0");$("timer").textContent=String(Math.floor(state.remaining/60)).padStart(2,"0")+":"+String(state.remaining%60).padStart(2,"0");$("arena-message").textContent=state.ended?(getWinner(state)==="draw"?"Empate!":"Vitória do time "+(getWinner(state)==="green"?"Verde":"Azul")+"!"):state.running?"Batalha em andamento!":"A batalha vai começar!";const historyList=$("round-history");if(historyList){historyList.innerHTML="";const history=[...state.history].reverse().slice(0,5);if(!history.length)historyList.innerHTML="<li class=\"empty-state\">Nenhuma rodada concluída ainda.</li>";else history.forEach(item=>{const li=document.createElement("li");li.textContent="Rodada "+String(item.round).padStart(2,"0")+" — "+item.winner+" (Verde "+item.greenVotes+" × Azul "+item.blueVotes+")";historyList.append(li);});}const voteGreen=$("green-votes"),voteBlue=$("blue-votes");if(voteGreen)voteGreen.textContent=state.votes.green;if(voteBlue)voteBlue.textContent=state.votes.blue;const list=$("ranking-list");list.innerHTML="";const ranks=Object.entries(state.ranking).sort((a,b)=>b[1]-a[1]).slice(0,5);if(!ranks.length)list.innerHTML="<li><span>1</span><span>Aguardando participação</span><b>—</b></li>";else ranks.forEach(([name,score],i)=>{const li=document.createElement("li");for(const value of [String(i+1),name,String(score)]){const s=document.createElement("span");s.textContent=value;li.append(s);}list.append(li);});}
function stop(){state.running=false;if(timer)clearInterval(timer);timer=null;}
function finishRound(){if(state.ended&&state.history.some(item=>item.round===state.round))return;stop();state.ended=true;const winner=getWinner(state);state.history.push({round:state.round,winner:winner==="draw"?"Empate":winner==="green"?"Time Verde":"Time Azul",greenVotes:state.votes.green,blueVotes:state.votes.blue});log("Fim da rodada: "+(winner==="draw"?"empate":winner==="green"?"Time Verde venceu":"Time Azul venceu"));burst("#e8bd63",50);renderState();}
function nextRound(){const history=[...state.history];const next=state.round+1;stop();state=createInitialState();state.history=history;state.round=next;green.position.x=-2.2;blue.position.x=2.2;green.rotation.y=0;blue.rotation.y=Math.PI;renderState();log("Rodada "+String(next).padStart(2,"0")+" iniciada; votos zerados.");}
function start(){if(state.ended)nextRound();state.running=true;if(timer)clearInterval(timer);timer=setInterval(()=>{if(!state.running)return;state.remaining--;if(state.remaining<=0){state.remaining=0;finishRound();}renderState();},1000);renderState();log("Partida iniciada");}
function reset(){stop();state=createInitialState();green.position.x=-2.2;blue.position.x=2.2;green.rotation.y=0;blue.rotation.y=Math.PI;$("event-feed").innerHTML='<div class="empty-state">Os eventos da partida aparecerão aqui.</div>';$("event-count").textContent="0";renderState();log("Arena reiniciada");}
function command(cmd,viewer=$("viewer-name").value||"Visitante"){if(state.ended)nextRound();const result=recordVote(state,cmd,viewer);if(!result.ok)return;if(result.type==="vote"){if(!state.running)start();if(result.team==="green"){applyDamage(state,"blue",1);animateStrike("green","blue");}else{applyDamage(state,"green",1);animateStrike("blue","green");}if(state.ended)finishRound();log(result.viewer+" votou no "+(result.team==="green"?"Time Verde":"Time Azul"));burst(result.team==="green"?"#21b875":"#428bff",8);}else if(result.type==="attack"){const team=Math.random()<.5?"green":"blue",target=team==="green"?"blue":"green";applyDamage(state,target,8);animateStrike(team,target);if(state.ended)finishRound();log(result.viewer+" pediu ataque!");burst("#ff7043",22);}else{const target=Math.random()<.5?"green":"blue";shield[target]=Date.now()+5000;state[target].shieldUntil=shield[target];log(result.viewer+" pediu defesa!");burst("#65d5ff",12);}sound(cmd==="!ataque"?120:360);renderState();}
document.querySelectorAll("[data-command]").forEach(b=>b.addEventListener("click",()=>command(b.dataset.command)));
$("send-comment").addEventListener("click",()=>{const v=$("viewer-name").value||"Visitante";command("!verde",v);});
function processGift(gift,viewer,source="simulado",giftName=""){if(gift==="confetti")burst("#ffd166",65);if(gift==="shield"){state.green.shieldUntil=Date.now()+6000;state.blue.shieldUntil=Date.now()+6000;burst("#65d5ff",25);}if(gift==="special"){const target=state.green.health>state.blue.health?"green":"blue";applyDamage(state,target,15);if(state.ended)finishRound();burst("#ff5c7a",50);}log(viewer+" enviou presente "+source+": "+(giftName||gift));sound(520);renderState();}
document.querySelectorAll("[data-gift]").forEach(b=>b.addEventListener("click",()=>processGift(b.dataset.gift,$("viewer-name").value||"Visitante")));
$("likes-btn").addEventListener("click",()=>{const n=Math.max(1,Math.min(1000000,Number($("likes-input").value)||1));state.likes+=n;log("+"+n.toLocaleString("pt-BR")+" curtidas simuladas");burst("#ff78b8",Math.min(80,Math.ceil(n/3)));});
$("start-btn").addEventListener("click",start);$("pause-btn").addEventListener("click",()=>{state.running=!state.running;if(state.running)start();else{if(timer)clearInterval(timer);timer=null;log("Partida pausada");renderState();}});$("reset-btn").addEventListener("click",reset);$("audio-btn").addEventListener("click",()=>{audio=!audio;$("audio-btn").textContent=audio?"🔊 Som ativado":"🔇 Som desativado";sound(440);});
const params=new URLSearchParams(location.search),wsUrl=params.get("ws")||(location.hostname!=="localhost"&&location.hostname!=="127.0.0.1"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/events":"");if(wsUrl){try{const ws=new WebSocket(wsUrl);ws.onopen=()=>{$("server-status").textContent="Gateway conectado";$("connection-label").textContent="GATEWAY TESTE";};ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return;}if(d.type==="status"){const live=d.tiktok?.connected===true;$("server-status").textContent=d.tiktok?.message||d.message||"Gateway conectado";$("connection-label").textContent=live?"TIKTOK LIVE CONECTADO":d.tiktok?.state==="connecting"?"CONECTANDO TIKTOK":"MODO DE TESTE";return;}if(d.type==="chat"){if(d.command)command(d.command,d.viewer);else if(d.comment)log("@"+d.viewer+": "+d.comment);}if(d.type==="gift")processGift(d.gift,d.viewer||"Espectador","real",d.giftName||"presente");if(d.type==="likes"){$("likes-input").value=d.count;$("likes-btn").click();}if(d.type==="social")log(d.event==="follow"?"@"+d.viewer+" começou a seguir":"@"+d.viewer+" compartilhou a live");};ws.onclose=()=>{$("server-status").textContent="Gateway desconectado";$("connection-label").textContent="GATEWAY DESCONECTADO";};}catch{}}

const connectScreen=$("connect-screen"),connectForm=$("connect-form"),usernameInput=$("tiktok-username"),connectBtn=$("connect-live-btn"),connectFeedback=$("connect-feedback"),enterGameBtn=$("enter-game-btn");
connectForm?.addEventListener("submit",async e=>{
 e.preventDefault();
 const username=usernameInput.value.trim().replace(/^@/,"");
 if(!/^[A-Za-z0-9._]{2,24}$/.test(username)){connectFeedback.textContent="Digite um usuário válido, sem espaços.";return;}
 connectBtn.disabled=true;connectBtn.textContent="Solicitando conexão…";connectFeedback.textContent="Enviando usuário ao servidor e verificando o estado da LIVE…";enterGameBtn.hidden=true;
 try{
  const response=await fetch("/api/tiktok/connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username})});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.message||"Não foi possível iniciar a conexão.");
  connectFeedback.textContent=data.message||("Solicitação enviada para "+data.username+".");
  connectBtn.textContent="Tentar conectar novamente";enterGameBtn.hidden=false;
  const statusResponse=await fetch("/api/tiktok/status");const status=await statusResponse.json();
  if(status.connected===true){connectFeedback.textContent="Conectado à LIVE de "+status.username+"! Você já pode entrar no jogo.";connectBtn.textContent="Conectado";enterGameBtn.textContent="Entrar no jogo";}
  else if(status.state==="needs-api-key"){connectFeedback.textContent="Usuário definido, mas a conexão real depende de configurar TIKTOOL_API_KEY nas variáveis privadas do Render. O jogo pode abrir em modo de teste.";enterGameBtn.textContent="Entrar no jogo (modo de teste)";}
 }catch(err){connectFeedback.textContent="Não foi possível confirmar a conexão: "+String(err.message||err);enterGameBtn.hidden=false;enterGameBtn.textContent="Entrar no jogo (modo de teste)";connectBtn.textContent="Tentar novamente";}
 finally{connectBtn.disabled=false;}
});
enterGameBtn?.addEventListener("click",()=>{connectScreen.hidden=true;});
\nfunction resize(){const r=$("arena").getBoundingClientRect();camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);}window.addEventListener("resize",resize);resize();renderState();
let t=0;function animate(){requestAnimationFrame(animate);t+=.016;for(const [name,f] of Object.entries(fighters)){const action=f.userData.action||0,hit=f.userData.hit||0;f.position.x=f.userData.baseX+(action>0?(name==="green"?1:-1)*Math.sin((.42-action)/.42*Math.PI)*.85:0);f.position.y=Math.abs(Math.sin(t*2.4+(name==="green"?0:1)))*.035+(hit>0?Math.sin((.32-hit)/.32*Math.PI)*.12:0);f.rotation.z=(hit>0?(name==="green"?1:-1)*Math.sin((.32-hit)/.32*Math.PI)*.22:0)+(state.running?Math.sin(t*2.6+(name==="green"?0:1))*.018:0);f.userData.action=Math.max(0,action-.016);f.userData.hit=Math.max(0,hit-.016);}for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.m.position.add(p.v);p.v.y-=.003;p.life--;if(p.life<=0){scene.remove(p.m);p.m.geometry.dispose();p.m.material.dispose();particles.splice(i,1);}}renderer.render(scene,camera);}animate();