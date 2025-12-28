"use client";

import { useMemo, useState, useRef, useEffect } from "react";

export const dynamic = "force-dynamic";

function fmt(n){
  if(n === null || n === undefined) return "-";
  const num = Number(n);
  if(Number.isNaN(num)) return String(n);
  if(num >= 1_000_000) return (num/1_000_000).toFixed(1) + "M";
  if(num >= 1_000) return (num/1_000).toFixed(1) + "K";
  return num.toFixed(0);
}

function makeMockCandles(count=140){
  let seed = 1337;
  const rnd = () => (seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff;
  let price = 0.10;
  const candles = [];
  const now = Date.now();
  const step = 60*60*1000; // 1h
  for(let i=count-1;i>=0;i--){
    const t = now - i*step;
    const drift = (rnd()-0.48) * 0.018;
    const vol = Math.max(0, (rnd()) * 18000);
    const open = price;
    price = Math.min(0.90, Math.max(0.02, price + drift));
    const close = price;
    const high = Math.min(0.98, Math.max(open, close) + rnd()*0.03);
    const low  = Math.max(0.01, Math.min(open, close) - rnd()*0.03);
    candles.push({ t, open, high, low, close, volume: vol });
  }
  return candles;
}

function makeMockOrderbook(mid=0.22){
  const asks = [];
  const bids = [];
  for(let i=0;i<18;i++){
    const pA = (mid + (i+1)*0.01).toFixed(2);
    const pB = (mid - (i+1)*0.01).toFixed(2);
    asks.push({ price: pA, shares: Math.round(40 + i*i*18), total: Math.round((40 + i*i*18) * Number(pA) * 100)/100 });
    bids.push({ price: pB, shares: Math.round(55 + i*i*20), total: Math.round((55 + i*i*20) * Number(pB) * 100)/100 });
  }
  return { mid, asks, bids };
}

function makeMockTrades(){
  const rows = [];
  const wallets = ["wolfofshelbyyy","nniu","0x38d...d34","0x968...21e","0x593...e97","0xa65...a67","0xa33...950","0xe5f...39b"];
  for(let i=0;i<14;i++){
    const side = i%4===0 ? "BUY" : "SELL";
    const price = side==="BUY" ? 0.22 : 0.99;
    const amount = i===0 ? 1700 : (i%3===0? 267 : (i%2===0? 259: 75));
    const total = Math.round(amount * price * 100)/100;
    const ageMin = i<6 ? 1 : (i<10 ? 8 : 13);
    rows.push({ outcome: "NO", side, price, amount, total, age: ageMin+"m", trader: wallets[i%wallets.length] });
  }
  return rows;
}

function LineChart({ candles }){
  const [hoverIdx, setHoverIdx] = useState(null);

  const w = 980, h = 320;
  const padL = 36, padR = 46, padT = 16, padB = 30;

  const closes = candles.map(c => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  const x = (i) => padL + (i/(candles.length-1))*(w-padL-padR);
  const y = (p) => {
    const t = (p - min) / (max - min || 1);
    return (h - padB) - t * (h - padT - padB);
  };

  const path = closes
    .map((p,i)=>`${i===0?'M':'L'} ${x(i).toFixed(2)} ${y(p).toFixed(2)}`)
    .join(" ");

  // grid y levels
  const levels = 4;
  const grid = Array.from({length:levels+1}).map((_,i)=>{
    const yy = padT + (i/levels)*(h-padT-padB);
    const val = (max - (i/levels)*(max-min)) * 100;
    return { yy, val };
  });

  const lastPct = closes[closes.length-1] * 100;

  const utcLabel = (ms) => {
    // "YYYY-MM-DD HH:mm UTC"
    const iso = new Date(ms).toISOString(); // always UTC
    return iso.slice(0,16).replace("T"," ") + " UTC";
  };

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const innerW = (w - padL - padR);
    const t = Math.max(0, Math.min(1, (px - (padL / w) * rect.width) / (innerW / w * rect.width)));
    const idx = Math.round(t * (candles.length - 1));
    setHoverIdx(idx);
  };

  const onLeave = () => setHoverIdx(null);

  const hi = hoverIdx !== null ? hoverIdx : (candles.length - 1);
  const hv = candles[hi];
  const hx = x(hi);
  const hy = y(hv.close);

  // tooltip position
  const tipW = 210;
  const tipH = 54;
  const tipX = Math.min(w - padR - tipW, Math.max(padL, hx - tipW/2));
  const tipY = Math.max(padT, hy - tipH - 10);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{width:"100%", height:"100%", cursor:"crosshair"}}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {/* grid */}
      {grid.map((g,i)=>(
        <g key={i}>
          <line x1={padL} x2={w-padR} y1={g.yy} y2={g.yy} stroke="rgba(255,255,255,0.07)" />
          <text
            x={w-padR+6}
            y={g.yy+4}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          >
            {g.val.toFixed(0)}%
          </text>
        </g>
      ))}

      {/* line */}
      <path d={path} fill="none" stroke="rgba(34,211,238,0.95)" strokeWidth="2.2" />

      {/* hover vertical line */}
      {hoverIdx !== null && (
        <line x1={hx} x2={hx} y1={padT} y2={h-padB} stroke="rgba(255,255,255,0.16)" />
      )}

      {/* last/hover dot */}
      <circle cx={hx} cy={hy} r="4.2" fill="rgba(34,211,238,0.95)" />

      {/* top-left label */}
      <text x={padL} y={padT+6} fill="rgba(34,211,238,0.95)" fontSize="22" fontWeight="900">
        {lastPct.toFixed(0)}% chance
      </text>

      {/* tooltip */}
      {hoverIdx !== null && (
        <g>
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx="10"
            fill="rgba(10,12,14,0.92)"
            stroke="rgba(255,255,255,0.10)"
          />
          <text x={tipX+10} y={tipY+20} fill="rgba(233,238,245,0.95)" fontSize="12" fontWeight="800">
            {(hv.close*100).toFixed(0)}%
          </text>
          <text
            x={tipX+10}
            y={tipY+40}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          >
            {utcLabel(hv.t)}
          </text>
        </g>
      )}
    </svg>
  );
}

function OrderBookPoly({ ob, defaultSide="yes" }){
  const [side, setSide] = useState(defaultSide); // YES/NO selector

  const asksRef = useRef(null);
  const bidsRef = useRef(null);

  const asks = useMemo(()=> [...ob.asks].sort((a,b)=>Number(b.price)-Number(a.price)), [ob]);
  const bids = useMemo(()=> [...ob.bids].sort((a,b)=>Number(b.price)-Number(a.price)), [ob]);

  let cumA = 0;
  const asksCum = asks.map(r => (cumA += Number(r.shares)));
  let cumB = 0;
  const bidsCum = bids.map(r => (cumB += Number(r.shares)));

  const maxAsk = asksCum.at(-1) || 1;
  const maxBid = bidsCum.at(-1) || 1;

  const Row = ({ r, cum, isAsk }) => {
    const pct = Math.max(0, Math.min(100, (cum / (isAsk ? maxAsk : maxBid)) * 100));
    return (
      <div style={{position:"relative", marginTop:"8px"}}>
        <div style={{
          position:"absolute",
          left:0, top:0, bottom:0,
          width:`${pct}%`,
          borderRadius:"10px",
          background: isAsk ? "rgba(239,68,68,0.16)" : "rgba(34,197,94,0.14)"
        }} />
        <div style={{
          position:"relative",
          display:"grid",
          gridTemplateColumns:"74px 1fr 1fr",
          gap:"10px",
          alignItems:"center",
          padding:"10px 10px",
          borderRadius:"10px",
          border:"1px solid rgba(255,255,255,0.06)",
          background:"rgba(255,255,255,0.02)"
        }}>
          <div className={isAsk ? "red" : "green"} style={{fontWeight:900}}>
            {(Number(r.price)*100).toFixed(0)}¢
          </div>
          <div className="mono muted">{fmt(r.shares)}</div>
          <div className="mono" style={{textAlign:"right"}}>${fmt(r.total)}</div>
        </div>
      </div>
    );
  };

  const listStyle = { maxHeight: 5*56, overflowY:"auto", paddingRight:"6px", scrollbarGutter:"stable" };

  const lastC = Math.round(ob.mid * 100);
  const spreadC = 1;

  useEffect(() => {
    // Asks: scroll to bottom so the best prices near mid are visible
    if (asksRef.current) {
      asksRef.current.scrollTop = asksRef.current.scrollHeight;
    }
    // Bids: keep at top to show best bid
    if (bidsRef.current) {
      bidsRef.current.scrollTop = 0;
    }
  }, [side, ob]);

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <div style={{fontWeight:900, fontSize:"13px"}}>Order Book</div>
        <div className="select-wrap">
          <select className="select" value={side} onChange={(e)=>setSide(e.target.value)}>
            <option value="yes">YES</option>
            <option value="no">NO</option>
          </select>
        </div>
      </div>

      <div style={{
        display:"grid",
        gridTemplateColumns:"74px 1fr 1fr",
        gap:"10px",
        marginTop:"10px",
        fontSize:"11px",
        color:"rgba(148,163,184,0.95)",
        fontWeight:800
      }}>
        <div>PRICE</div>
        <div>SHARES</div>
        <div style={{textAlign:"right"}}>TOTAL</div>
      </div>

      <div style={{marginTop:"10px"}}>
        <div style={{display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px"}}>
          <span className="pill" style={{color:"#fff", background:"rgba(239,68,68,0.18)"}}>Asks ({side.toUpperCase()})</span>
        </div>
        <div ref={asksRef} style={listStyle}>
          {asks.map((r,i)=>(
            <Row key={"a"+i} r={r} cum={asksCum[i]} isAsk />
          ))}
        </div>
      </div>

      <div style={{
        marginTop:"12px",
        padding:"10px 10px",
        borderTop:"1px solid rgba(255,255,255,0.06)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        display:"flex",
        justifyContent:"space-between",
        color:"rgba(148,163,184,0.95)",
        fontSize:"12px",
        fontWeight:800
      }}>
        <div>Last: <span className="mono" style={{color:"#e9eef5"}}>{lastC}¢</span></div>
        <div>Spread: <span className="mono" style={{color:"#e9eef5"}}>{spreadC}¢</span></div>
      </div>

      <div style={{marginTop:"12px"}}>
        <div style={{display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px"}}>
          <span className="pill" style={{color:"#fff", background:"rgba(34,197,94,0.18)"}}>Bids ({side.toUpperCase()})</span>
        </div>
        <div ref={bidsRef} style={listStyle}>
          {bids.map((r,i)=>(
            <Row key={"b"+i} r={r} cum={bidsCum[i]} isAsk={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page({ searchParams }) {
  const marketId = searchParams?.marketId ?? "test";
  const outcomeId = searchParams?.outcomeId ?? "yes";
  const interval = searchParams?.interval ?? "1h";
  const theme = searchParams?.theme ?? "dark";

  const candlesYes = useMemo(()=>makeMockCandles(160), []);
  const candlesNo  = useMemo(()=>makeMockCandles(160), []);
  const [chartOutcome, setChartOutcome] = useState(outcomeId === "no" ? "no" : "yes");
  const chartCandles = chartOutcome === "no" ? candlesNo : candlesYes;
  const obYes = useMemo(()=>makeMockOrderbook(0.22), []);
  const obNo  = useMemo(()=>makeMockOrderbook(0.78), []);
  const trades = useMemo(()=>makeMockTrades(), []);

  const title = "Will Bitcoin reach $250,000 by December 31, 2025?";

  const ob = outcomeId === "no" ? obNo : obYes;

  return (
    <div style={{padding:"10px"}}>
      <div style={{display:"flex", gap:"10px", alignItems:"center", justifyContent:"space-between"}}>
        <div style={{display:"flex", flexDirection:"column", gap:"4px"}}>
          <div style={{fontWeight:900, fontSize:"13px"}}>{title}</div>
          <div style={{display:"flex", gap:"10px", fontSize:"12px", color:"rgba(148,163,184,0.95)"}}>
            <span>marketId: <span className="mono">{marketId}</span></span>
            <span>outcomeId: <span className="mono">{outcomeId}</span></span>
            <span>interval: <span className="mono">{interval}</span></span>
            <span>theme: <span className="mono">{theme}</span></span>
          </div>
        </div>
        <div style={{display:"flex", gap:"8px", alignItems:"center"}}>
          <span className="tag"><span className="dot"></span>LIVE</span>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1fr 340px", gap:"12px", marginTop:"10px"}}>
        <div className="panel" style={{padding:"10px"}}>
{(() => {
  const [range, setRange] = useState("1d"); // default

  const ranges = [
    ["1h","1h"],
    ["6h","6h"],
    ["1d","1d"],
    ["1w","1w"],
    ["All","all"],
  ];

  const rangeMs = (key) => {
    if(key==="1h") return 1*60*60*1000;
    if(key==="6h") return 6*60*60*1000;
    if(key==="1d") return 24*60*60*1000;
    if(key==="1w") return 7*24*60*60*1000;
    return null; // all
  };

  <div className="select-wrap" style={{marginRight:"6px"}}>
  <select
    className="select"
    value={chartOutcome}
    onChange={(e)=>setChartOutcome(e.target.value)}
  >
    <option value="yes">YES</option>
    <option value="no">NO</option>
  </select>
</div>

  const filtered = useMemo(()=>{
  const ms = rangeMs(range);
  if(!ms) return chartCandles;
  const end = chartCandles.at(-1)?.t ?? Date.now();
  const start = end - ms;
  const arr = chartCandles.filter(c => c.t >= start);
  return arr.length >= 5 ? arr : chartCandles.slice(-20);
}, [chartCandles, range]);

  return (
    <>
      <div style={{height:"340px"}}>
        <LineChart candles={filtered} />
      </div>

      {/* range buttons nằm dưới trục ngang */}
      <div style={{display:"flex", gap:"8px", marginTop:"8px", alignItems:"center"}}>
        {ranges.map(([label, key]) => (
          <button
            key={key}
            className="btn"
            onClick={()=>setRange(key)}
            style={{opacity: range===key ? 1 : 0.65}}
          >
            {label}
          </button>
        ))}
        <div className="spacer" />
        <div className="muted" style={{fontSize:"12px"}}>UTC tooltip on hover</div>
      </div>
    </>
  );
})()}

          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:"8px"}}>
            <div style={{display:"flex", gap:"12px", color:"rgba(148,163,184,0.95)", fontSize:"12px"}}>
              <div>Volume: <span style={{color:"rgba(34,197,94,0.95)", fontWeight:900}}>{fmt(candles.at(-1)?.volume)}</span></div>
              <div>Last: <span style={{color:"rgba(34,211,238,0.95)", fontWeight:900}}>{(candles.at(-1)?.close ?? 0).toFixed(2)}</span></div>
            </div>
            <div className="muted" style={{fontSize:"12px"}}>Demo chart (mock)</div>
          </div>

          <div className="panel" style={{marginTop:"12px"}}>
            <div className="tabs">
              <div className="tab active">Trades</div>
              <div className="tab">Top Traders</div>
              <div className="tab">Holders</div>
            </div>
            <div style={{padding:"10px"}}>
              <table>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>Total USD</th>
                    <th>Age</th>
                    <th>Trader</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, idx)=>(
                    <tr key={idx}>
                      <td>{t.outcome}</td>
                      <td className={t.side==="BUY" ? "green badge" : "red badge"}>{t.side}</td>
                      <td>{t.price}</td>
                      <td>{fmt(t.amount)}</td>
                      <td>${fmt(t.total)}</td>
                      <td>{t.age}</td>
                      <td className="mono">{t.trader}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel" style={{padding:"10px", height:"fit-content"}}>
          <OrderBookPoly ob={ob} defaultSide={outcomeId === "no" ? "no" : "yes"} />
</div>
      </div>
    </div>
  );
}
