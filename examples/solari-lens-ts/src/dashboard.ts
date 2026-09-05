import { createServer, type Server } from "node:http"
import { LensStore } from "./lens.js"
import { exportMarkdown, exportRun } from "./export.js"
import { dashboardPage } from "./dashboard-page.js"

const legacyPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solari Lens</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17212b;background:#f4f7f8}*{box-sizing:border-box}body{margin:0}.top{background:#102a36;color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:end}.top h1{font-size:22px;margin:0 0 4px}.top p{margin:0;color:#b8ced4;font-size:13px}.badge{border:1px solid #527885;padding:6px 9px;font-size:12px}.layout{display:grid;grid-template-columns:310px minmax(0,1fr);min-height:calc(100vh - 82px)}aside{background:#fff;border-right:1px solid #d9e1e4;padding:18px}.run{display:block;width:100%;text-align:left;background:#fff;border:1px solid #d9e1e4;padding:12px;margin:0 0 9px;cursor:pointer}.run.active{border-color:#e36f42;box-shadow:inset 3px 0 #e36f42}.run strong{display:block;font-size:13px}.run small{display:block;color:#60717a;margin-top:6px}.main{padding:24px;max-width:1100px;width:100%}.outcomes{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.outcome{background:#fff;border:1px solid #d9e1e4;padding:9px 11px;font-size:12px}.outcome b{display:block;font-size:10px;text-transform:uppercase;color:#6b7b82;margin-bottom:4px}.story{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px}.timeline,.evidence{background:#fff;border:1px solid #d9e1e4}.timeline{padding:16px}.evidence{padding:16px;min-height:220px}.event{border-left:3px solid #8ea4ad;padding:10px 12px;margin:0 0 10px;background:#fbfcfc}.event.browser{border-color:#3976a8}.event.sandbox{border-color:#518e62}.event.desktop{border-color:#a56d2e}.event.agent{border-color:#7b5c9c}.event strong{font-size:13px}.event p{margin:5px 0 0;font-size:13px;line-height:1.4}.meta{font-size:11px;color:#667880;margin-top:7px}.tag{display:inline-block;padding:2px 5px;background:#eaf0f2;margin-right:5px}.empty{color:#6b7b82;font-size:14px;padding:20px 0}.artifact{border-top:1px solid #e4eaec;padding:11px 0}.artifact:first-child{border-top:0}.artifact b{font-size:13px}.artifact p{font-size:12px;line-height:1.45}.muted{color:#667880}@media(max-width:800px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #d9e1e4}.story{grid-template-columns:1fr}}
</style></head><body><header class="top"><div><h1>Solari Lens</h1><p>Evidence-linked visibility across Browser, Sandbox, and Desktop</p></div><span class="badge">PROPOSED SOLARI FEATURE</span></header><div class="layout"><aside><h2 style="font-size:14px;margin:0 0 12px">Runs</h2><div id="runs"></div></aside><main class="main"><div id="content" class="empty">Loading runs…</div></main></div>
<script>
let selected;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function get(path){const r=await fetch(path);return r.json()}
function outcome(run){const o=run.outcome||{};return [['Investigation',o.executionStatus||run.status],['Checkout',o.taskOutcome||'pending'],['Diagnosis',o.diagnosis||'pending'],['Cleanup',o.cleanupStatus||'pending']].map(([k,v])=>'<span class="outcome"><b>'+esc(k)+'</b>'+esc(v)+'</span>').join('')}
function renderRuns(runs){document.querySelector('#runs').innerHTML=runs.map(r=>'<button class="run '+(r.id===selected?'active':'')+'" data-run-id="'+esc(r.id)+'"><strong>'+esc(r.name)+'</strong><small>'+esc(r.status)+' · '+esc(r.startedAt)+'</small></button>').join('');document.querySelectorAll('[data-run-id]').forEach(button=>button.addEventListener('click',()=>selectRun(button.dataset.runId)))}
function artifactContent(a){if(!a.content)return '';if(a.type==='screenshot'&&a.content!=='synthetic-screenshot')return '<img style="max-width:100%;border:1px solid #d9e1e4;margin-top:8px" alt="'+esc(a.summary)+'" src="data:image/png;base64,'+a.content+'">';if(a.type==='report'||a.type==='diagnosis')return '<pre style="white-space:pre-wrap;background:#f4f7f8;padding:9px;font-size:11px;margin-top:8px">'+esc(a.content)+'</pre>';return '<p class="muted">Artifact content is available in the local store.</p>'}
function render(data){const events=data.events||[], artifacts=data.artifacts||[];document.querySelector('#content').innerHTML='<div class="outcomes">'+outcome(data.run)+'</div><div class="story"><section class="timeline"><h2 style="font-size:16px;margin:0 0 14px">Run story</h2>'+events.map(e=>'<article class="event '+esc(e.environment)+'"><strong>'+esc(e.summary)+'</strong><p>'+esc(e.type)+'</p><div class="meta"><span class="tag">'+esc(e.provenance)+'</span><span class="tag">'+esc(e.status)+'</span>#'+esc(e.sequence)+'</div></article>').join('')+'</section><section class="evidence"><h2 style="font-size:16px;margin:0 0 14px">Evidence</h2>'+(artifacts.length?artifacts.map(a=>'<div class="artifact"><b>'+esc(a.type)+' · '+esc(a.state)+'</b><p>'+esc(a.summary)+'</p><small class="muted">'+esc(a.environment)+' · '+esc(a.metadata?.reviewedForSharing?'reviewed for sharing':'not reviewed for sharing')+'</small>'+artifactContent(a)+'</div>').join(''):'<p class="muted">No artifacts attached.</p>')+'</section></div>'}
async function selectRun(id){if(stream)stream.close();stream=undefined;selected=id;await refresh()}
let stream, refreshing=false, refreshAgain=false;
const cursors=new Map();
async function refresh(){if(refreshing){refreshAgain=true;return}refreshing=true;try{const runs=await get('/api/runs');if(!selected&&runs[0])selected=runs[0].id;renderRuns(runs);const id=selected;if(id){const data=await get('/api/runs/'+encodeURIComponent(id));if(id!==selected)return;render(data);const sequence=Math.max(0,...data.events.map(e=>e.sequence));cursors.set(id,Math.max(cursors.get(id)||0,sequence));if(!stream)openStream(id)}}catch(error){console.error('Run refresh failed',error)}finally{refreshing=false;if(refreshAgain){refreshAgain=false;refresh()}}}
function openStream(id){stream=new EventSource('/events/'+encodeURIComponent(id)+'?after='+(cursors.get(id)||0));stream.onmessage=event=>{if(id!==selected)return;const sequence=Number(event.lastEventId);if(sequence<=(cursors.get(id)||0))return;cursors.set(id,sequence);refresh()}}
refresh();setInterval(()=>{if(!stream||stream.readyState===2)refresh()},5000);
</script></body></html>`

export function startDashboard(store: LensStore, port: number): Server {
  const streams = new Set<import("node:http").ServerResponse>()
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    res.setHeader("Cache-Control", "no-store")
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(dashboardPage)
      return
    }
    if (url.pathname === "/api/runs") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(store.runs()))
      return
    }
    if (url.pathname.startsWith("/api/exports/")) {
      const runId = decodeURIComponent(url.pathname.slice("/api/exports/".length))
      const content = exportRun(store, runId)
      if (!content) { res.writeHead(404); res.end("Not found"); return }
      res.writeHead(200, { "content-type": "application/x-ndjson", "content-disposition": 'attachment; filename="lens-run.jsonl"' })
      res.end(content)
      return
    }
    if (url.pathname.startsWith("/api/exports-markdown/")) {
      const runId = decodeURIComponent(url.pathname.slice("/api/exports-markdown/".length))
      const content = exportMarkdown(store, runId)
      if (!content) { res.writeHead(404); res.end("Not found"); return }
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="lens-run.md"' })
      res.end(content)
      return
    }
    if (url.pathname.startsWith("/api/runs/")) {
      const data = store.run(decodeURIComponent(url.pathname.slice("/api/runs/".length)))
      if (!data) { res.writeHead(404); res.end("Not found"); return }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(data))
      return
    }
    if (url.pathname.startsWith("/events/")) {
      const runId = decodeURIComponent(url.pathname.slice("/events/".length))
      if (!store.run(runId)) { res.writeHead(404); res.end("Not found"); return }
      const cursor = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? "0"
      let sequence = Number(cursor)
      if (!Number.isSafeInteger(sequence) || sequence < 0) { res.writeHead(400); res.end("Invalid event cursor"); return }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
      res.flushHeaders()
      streams.add(res)
      const send = () => {
        const events = store.eventsSince(runId, sequence) as Array<{ sequence: number }>
        for (const event of events) {
          sequence = event.sequence
          res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)
        }
      }
      send()
      const timer = setInterval(send, 500)
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000)
      res.on("close", () => { clearInterval(timer); clearInterval(heartbeat); streams.delete(res) })
      return
    }
    if (url.pathname.startsWith("/api/artifacts/")) {
      if (req.method === "POST" && url.pathname.endsWith("/review")) {
        const artifactId = decodeURIComponent(url.pathname.slice("/api/artifacts/".length, -"/review".length))
        if (!store.reviewArtifact(artifactId, true)) { res.writeHead(404); res.end("Not found"); return }
        res.writeHead(204)
        res.end()
        return
      }
      const artifact = store.artifact(decodeURIComponent(url.pathname.slice("/api/artifacts/".length)))
      if (!artifact) { res.writeHead(404); res.end("Not found"); return }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(artifact))
      return
    }
    res.writeHead(404)
    res.end("Not found")
  })
  server.on("close", () => { for (const response of streams) response.end(); streams.clear() })
  server.listen(port, "127.0.0.1", () => console.log(`Lens dashboard: http://127.0.0.1:${port}`))
  return server
}
