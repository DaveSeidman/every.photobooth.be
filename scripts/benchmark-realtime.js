// Isolated QA room: no image generation, guest counters, or printing.
import { WebSocket } from "ws";
import { performance } from "node:perf_hooks";
const url=process.argv[2] || "ws://127.0.0.1:8000/ws";
const count=Number(process.argv[3]) || 60;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clients=[];
const waitFor=(socket,type)=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket.off("message",handler);reject(new Error(`Timed out: ${type}`));},8000);
  const handler=raw=>{const message=JSON.parse(raw);if(message.type===type){clearTimeout(timeout);socket.off("message",handler);resolve(message);}};
  socket.on("message",handler);
});
const room=`qa-motion-${Date.now()}`;
const join=async(role)=>{
  const socket=new WebSocket(url,{origin:"https://photobooth.lightboxlive.io",handshakeTimeout:10000});clients.push(socket);
  await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});
  const session=waitFor(socket,"session");socket.send(JSON.stringify({type:"join",photoId:room,role,clientId:`qa-${role}-${Date.now()}`}));await session;
  return socket;
};
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0);};
try {
  const kiosk=await join("kiosk"),phone=await join("phone");
  const grabbed=waitFor(kiosk,"takeaway:interaction");phone.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"qa-motion-gesture"}));await grabbed;
  const sent=new Map(),latencies=[],gaps=[];let last;
  kiosk.on("message",raw=>{
    const event=JSON.parse(raw);if(event.type!=="takeaway:interaction"||event.action!=="pull")return;
    const now=performance.now(),seq=Math.round(event.x*1000);
    if(sent.has(seq))latencies.push(now-sent.get(seq));if(last)gaps.push(now-last);last=now;
  });
  for(let i=1;i<=count;i++){
    sent.set(i,performance.now());phone.send(JSON.stringify({type:"takeaway:interaction",action:"pull",gestureId:"qa-motion-gesture",x:i/1000,progress:i/count}));await delay(1000/30);
  }
  await delay(1500);
  console.log(JSON.stringify({url,sent:count,received:latencies.length,relayMedianMs:percentile(latencies,.5),relayP95Ms:percentile(latencies,.95),gapMedianMs:percentile(gaps,.5),gapP95Ms:percentile(gaps,.95)},null,2));
} finally {clients.forEach(socket=>socket.close());}
