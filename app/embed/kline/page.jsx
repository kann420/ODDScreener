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

function fmtPct(p) {
  // Opinion-like: show one decimal (e.g. 0.2%, 99.8%)
  return `${p.toFixed(1)}%`;
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
  const wallets = ["wolfofshelbyyy","nniu","0x38d...d34","0x968...21e","0x593... e97","0xa65...a67","0xa33...950","0xe5f...39b"];
  for(let i=0;i<14;i++){
    const side = i%4===0 ? "BUY" : "SELL";
    const price = side==="BUY" ? 0.22 :  0.99;
    const amount = i===0 ? 1700 : (i%3===0? 267 : (i%2===0? 259: 75));
    const total = Math.round(amount * price * 100)/100;
    const ageMin = i<6 ? 1 : (i<10 ? 8 :  13);
    rows.push({ outcome: "NO", side, price, amount, total, age: ageMin+"m", trader: wallets[i%wallets.length] });
  }
  return rows;
}

function LineChart({ candles, color="rgba(34,211,238,0.95)", range="1d" }){
  const [hoverIdx, setHoverIdx] = useState(null);

  const w = 980, h = 320;
  const padL = 36, padR = 46, padT = 16, padB = 30;

  // Render with a consistent point count so transitions (YES<->NO, range) look smooth
  const N = 160;

  // Month names for date formatting
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Helper function to format time in 12-hour am/pm format
  const formatTime12Hour = (d) => {
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return { hours, minutes, ampm };
  };

  const formatTooltipLabel = (ms) => {
    const d = new Date(ms);
    const { hours, minutes, ampm } = formatTime12Hour(d);
    const month = monthNames[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    return `${hours}:${minutes}${ampm}, ${month} ${day}, ${year}`;
  };

  // Format X-axis labels based on range
  const formatXAxisLabel = (ms, range) => {
    const d = new Date(ms);
    if (range === "1h" || range === "6h") {
      // Show time in 12:00pm format
      const { hours, minutes, ampm } = formatTime12Hour(d);
      return `${hours}:${minutes}${ampm}`;
    } else if (range === "1d") {
      // Show date like "Dec 29"
      const month = monthNames[d.getMonth()];
      const day = d.getDate();
      return `${month} ${day}`;
    } else {
      // 1w or all: Show dates like "Dec 22"
      const month = monthNames[d.getMonth()];
      const day = d.getDate();
      return `${month} ${day}`;
    }
  };

  const sampled = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    const out = [];
    const L = candles.length;
    for (let i = 0; i < N; i++) {
      const idx = Math.round((i/(N-1)) * (L-1));
      out.push(candles[idx]);
    }
    return out;
  }, [candles]);

  // Generate tick positions for X-axis (approximately 4-6 labels)
  const getXAxisTicks = useMemo(() => {
    if (!sampled || sampled.length === 0) return [];
    
    const numTicks = 5; // Show 5 labels across the chart
    const ticks = [];
    
    for (let i = 0; i < numTicks; i++) {
      const idx = Math.round((i / (numTicks - 1)) * (sampled.length - 1));
      const candle = sampled[idx];
      if (candle) {
        ticks.push({
          idx,
          timestamp: candle.t,
          label: formatXAxisLabel(candle.t, range)
        });
      }
    }
    
    return ticks;
  }, [sampled, range]);

  const closes = useMemo(() => sampled.map(c => c.close), [sampled]);
  const min = useMemo(() => closes.length ? Math.min(...closes) : 0, [closes]);
  const max = useMemo(() => closes.length ? Math.max(...closes) : 1, [closes]);

  const x = (i) => padL + (i/(N-1))*(w-padL-padR);
  const y = (p) => {
    const t = (p - min) / (max - min || 1);
    return (h - padB) - t * (h - padT - padB);
  };

  const pts = useMemo(() => {
    return sampled.map((c,i)=>({ x: x(i), y: y(c.close), t: c.t, v: c.close }));
  }, [sampled, min, max]);

  const linePath = pts.length
    ? pts.map((p,i)=>`${i===0?'M':'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
    : "";

  const areaPath = pts.length ? (
    linePath +
    ` L ${(w-padR).toFixed(2)} ${(h-padB).toFixed(2)}` +
    ` L ${padL.toFixed(2)} ${(h-padB).toFixed(2)} Z`
  ) : "";

  // grid y levels
  const levels = 4;
  const grid = Array.from({length:levels+1}).map((_,i)=>{
    const yy = padT + (i/levels)*(h-padT-padB);
    const val = (max - (i/levels)*(max-min)) * 100;
    return { yy, val };
  });

  const lastPct = closes.length ? closes[closes.length-1] * 100 : 0;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const innerW = (w - padL - padR);
    const t = Math.max(0, Math.min(1, (px - (padL / w) * rect.width) / (innerW / w * rect.width)));
    const idx = Math.round(t * (N - 1));
    setHoverIdx(idx);
  };

  const onLeave = () => setHoverIdx(null);

  const hi = hoverIdx !== null ? hoverIdx : (N - 1);
  const hv = pts[hi] || pts[pts.length-1];

  const hx = hv?.x ?? x(N-1);
  const hy = hv?.y ?? y(closes[closes.length-1] ?? 0);

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
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.00" />
        </linearGradient>

        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

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
            {fmtPct(g.val)}
          </text>
        </g>
      ))}

      {/* X-axis time labels */}
      {getXAxisTicks.map((tick, i) => {
        const tickX = x(Math.round((tick.idx / (sampled.length - 1)) * (N - 1)));
        return (
          <text
            key={`tick-${i}`}
            x={tickX}
            y={h - padB + 18}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            textAnchor="middle"
          >
            {tick.label}
          </text>
        );
      })}

      {/* area */}
      {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}

      {/* line + glow */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.4" filter="url(#glow)" />

      {/* hover vertical line */}
      {hoverIdx !== null && (
        <line x1={hx} x2={hx} y1={padT} y2={h-padB} stroke="rgba(255,255,255,0.16)" />
      )}

      {/* last/hover dot */}
      <circle cx={hx} cy={hy} r="4.2" fill={color} />

      {/* tooltip */}
      {hoverIdx !== null && hv && (
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
            {fmtPct(hv.v*100)}
          </text>
          <text
            x={tipX+10}
            y={tipY+40}
            fill="rgba(148,163,184,0.95)"
            fontSize="11"
            fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          >
            {formatTooltipLabel(hv.t)}
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

  const asks = useMemo(()=> [... ob.asks].sort((a,b)=>Number(b.price)-Number(a.price)), [ob]);
  const bids = useMemo(()=> [...ob.bids].sort((a,b)=>Number(b.price)-Number(a.price)), [ob]);

  // Calculate cumulative totals for orderbook depth
  const asksCum = useMemo(() => {
    const cum = [];
    let sum = 0;
    for (let i = 0; i < asks.length; i++) {
      sum += Number(asks[i].total) || 0;
      cum.push(sum);
    }
    return cum;
  }, [asks]);

  const bidsCum = useMemo(() => {
    const cum = [];
    let sum = 0;
    for (let i = 0; i < bids.length; i++) {
      sum += Number(bids[i].total) || 0;
      cum.push(sum);
    }
    return cum;
  }, [bids]);

  // Depth shading like Polymarket: per-level TOTAL (USD) normalized per side
const maxLevelAsk = Math.max(1, ...asks.map(r => Number(r.total) || 0));
const maxLevelBid = Math.max(1, ...bids.map(r => Number(r.total) || 0));
const Row = ({ r, isAsk }) => {
    const levelTotal = Number(r.total) || 0;
    const pct = Math.max(0, Math.min(100, (levelTotal / (isAsk ? maxLevelAsk : maxLevelBid)) * 100));
return (
      <div style={{position:"relative", overflow:"hidden", marginTop:"6px"}}>
        <div style={{
          position:"absolute",
          left:0, top:0, bottom:0,
          width:`${pct}%`,
          borderRadius:"0px",
          background: isAsk ? "rgba(239,68,68,0.26)" : "rgba(34,197,94,0.22)"
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
          <div className={isAsk ? "red" : "green"} style={{fontWeight: 900}}>
            {(Number(r.price)*100).toFixed(0)}¢
          </div>
          <div className="mono muted">{fmt(r.shares)}</div>
          <div className="mono" style={{textAlign:"right"}}>${fmt(r.total)}</div>
        </div>
      </div>
    );
  };

  const listStyle = { maxHeight:  5*56, overflowY:"auto", paddingRight:"6px", scrollbarGutter:"stable" };

  const lastC = Math.round(ob.mid * 100);
  const spreadC = 1;

  useEffect(() => {
    // Asks:  scroll to bottom so the best prices near mid are visible
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
        <div>Last:  <span className="mono" style={{color:"#e9eef5"}}>{lastC}¢</span></div>
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
  const marketId = searchParams?.marketId ??  "test";
  const outcomeId = searchParams?.outcomeId ?? "yes";
  const interval = searchParams?.interval ?? "1h";
  const theme = searchParams?.theme ?? "dark";

  const candlesYes = useMemo(()=>makeMockCandles(160), []);
  const [chartOutcome, setChartOutcome] = useState(outcomeId === "no" ? "no" : "yes");
  const [isFlip3D, setIsFlip3D] = useState(false);

const [flipT, setFlipT] = useState(chartOutcome === "no" ? 1 : 0);
const flipRef = useRef(flipT);

useEffect(() => { flipRef.current = flipT; }, [flipT]);

// "Mirror flip" animation like the video: YES <-> NO reflects around 50%
useEffect(() => {
  const target = chartOutcome === "no" ? 1 : 0;
  const from = flipRef.current;
  const dur = 260; // ms (snappy like Opinion)
  const start = performance.now();
  let raf = null;

  const easeInOut = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;

  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = easeInOut(t);
    setFlipT(from + (target - from) * e);
    if (t < 1) raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => raf && cancelAnimationFrame(raf);
}, [chartOutcome]);
  
  useEffect(() => {
    // subtle 3D flip like the reference video
    setIsFlip3D(true);
    const t = setTimeout(() => setIsFlip3D(false), 220);
    return () => clearTimeout(t);
  }, [chartOutcome]);
  
  const chartCandlesBase = candlesYes;
  const chartCandles = useMemo(() => {
    // Display series morphs from YES to NO via flipT: v = lerp(v, 1-v)
    if (!chartCandlesBase?.length) return [];
    return chartCandlesBase.map(c => {
      const v = c.close;
      const v2 = v*(1 - flipT) + (1 - v)*flipT;
      return { ...c, close: v2 };
    });
  }, [chartCandlesBase, flipT]);
  const obYes = useMemo(()=>makeMockOrderbook(0.22), []);
  const obNo  = useMemo(()=>makeMockOrderbook(0.78), []);
  const trades = useMemo(()=>makeMockTrades(), []);

  const title = "Will Bitcoin reach $250,000 by December 31, 2025?";

  const ob = chartOutcome === "no" ? obNo : obYes;

  const [range, setRange] = useState("1d");

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

  const filtered = useMemo(()=>{
    const ms = rangeMs(range);
    if(! ms) return chartCandles;
    const end = chartCandles.at(-1)?.t ??  Date.now();
    const start = end - ms;
    const arr = chartCandles.filter(c => c.t >= start);
    return arr.length >= 5 ? arr : chartCandles.slice(-20);
  }, [chartCandles, range]);

  // Calculate last percentage for display
  const lastPct = useMemo(() => {
    const lastClose = filtered.at(-1)?.close;
    return lastClose !== undefined ? lastClose * 100 : 0;
  }, [filtered]);

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
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
  <div style={{
    display:"inline-flex",
    border:"1px solid rgba(255,255,255,0.10)",
    background:"rgba(255,255,255,0.03)",
    borderRadius:"12px",
    padding:"2px",
    gap:"2px"
  }}>
    <button
      className="btn"
      onClick={()=>setChartOutcome("yes")}
      style={{
        padding:"6px 10px",
        borderRadius:"10px",
        opacity: chartOutcome==="yes" ? 1 : 0.65,
        background: chartOutcome==="yes" ? "rgba(34,211,238,0.18)" : "transparent",
        border: chartOutcome==="yes" ? "1px solid rgba(34,211,238,0.30)" : "1px solid transparent"
      }}
    >
      YES
    </button>
    <button
      className="btn"
      onClick={()=>setChartOutcome("no")}
      style={{
        padding:"6px 10px",
        borderRadius:"10px",
        opacity: chartOutcome==="no" ? 1 : 0.65,
        background: chartOutcome==="no" ? "rgba(168,85,247,0.16)" : "transparent",
        border: chartOutcome==="no" ? "1px solid rgba(168,85,247,0.28)" : "1px solid transparent"
      }}
    >
      NO
    </button>
  </div>
  <div style={{
    fontSize:"12px",
    fontWeight:"700",
    color: chartOutcome==="yes" ? "rgba(34,211,238,0.95)" : "rgba(168,85,247,0.95)"
  }}>
    {fmtPct(lastPct)} chance
  </div>
</div>

          <div style={{marginTop:"8px"}}>
  <div
    style={{
      height: "340px",
      transformOrigin: "50% 50%",
      transform: isFlip3D
        ? "perspective(900px) rotateX(10deg) scale(0.995)"
        : "perspective(900px) rotateX(0deg) scale(1)",
      transition: "transform 220ms ease",
      willChange: "transform",
      filter: isFlip3D ? "saturate(1.06)" : "none",
    }}
  >
    <LineChart key={chartOutcome} candles={filtered} color={chartOutcome==="yes" ? "rgba(34,211,238,0.95)" : "rgba(168,85,247,0.95)"} range={range} />
  </div>
</div>

          {/* range buttons */}
          <div style={{display:"flex", gap:"8px", marginTop:"8px", alignItems:"center"}}>
            {ranges.map(([label, key]) => (
              <button
                key={key}
                className="btn"
                onClick={()=>setRange(key)}
                style={{opacity:  range===key ? 1 : 0.65}}
              >
                {label}
              </button>
            ))}
            <div className="spacer" />
            <div className="muted" style={{fontSize:"12px"}}>UTC tooltip on hover</div>
          </div>

          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:"8px"}}>
            <div style={{display:"flex", gap:"12px", color:"rgba(148,163,184,0.95)", fontSize:"12px"}}>
              <div>Volume:  <span style={{color:"rgba(34,197,94,0.95)", fontWeight:900}}>{fmt(chartCandles.at(-1)?.volume)}</span></div>
              <div>Last: <span style={{color: chartOutcome==="yes" ? "rgba(34,211,238,0.95)" : "rgba(168,85,247,0.95)", fontWeight:900}}>{(chartCandles.at(-1)?.close ??  0).toFixed(2)}</span></div>
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
