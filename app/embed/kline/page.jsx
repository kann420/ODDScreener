export const dynamic = "force-dynamic";

function fmt(n){
  if(n === null || n === undefined) return "-";
  const num = Number(n);
  if(Number.isNaN(num)) return String(n);
  if(num >= 1_000_000) return (num/1_000_000).toFixed(1) + "M";
  if(num >= 1_000) return (num/1_000).toFixed(1) + "K";
  return num.toString();
}

function makeMockCandles(count=80){
  // Deterministic-ish based on count and a simple LCG
  let seed = 1337;
  const rnd = () => (seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff;
  let price = 0.22;
  const candles = [];
  const now = Date.now();
  const step = 60*60*1000; // 1h
  for(let i=count-1;i>=0;i--){
    const t = now - i*step;
    const drift = (rnd()-0.5) * 0.03;
    const vol = Math.max(0, (rnd()) * 14000);
    const open = price;
    price = Math.min(0.95, Math.max(0.02, price + drift));
    const close = price;
    const high = Math.min(0.98, Math.max(open, close) + rnd()*0.06);
    const low  = Math.max(0.01, Math.min(open, close) - rnd()*0.05);
    candles.push({ t, open, high, low, close, volume: vol });
  }
  return candles;
}

function makeMockOrderbook(){
  const mid = 0.20;
  const asks = [];
  const bids = [];
  for(let i=0;i<10;i++){
    const pA = (mid + (i+1)*0.01).toFixed(2);
    const pB = (mid - (i+1)*0.01).toFixed(2);
    asks.push({ price: pA, shares: Math.round(50 + i*i*30), total: Math.round((50 + i*i*30) * Number(pA) * 100)/100 });
    bids.push({ price: pB, shares: Math.round(60 + i*i*35), total: Math.round((60 + i*i*35) * Number(pB) * 100)/100 });
  }
  return { mid, asks, bids };
}

function makeMockTrades(){
  const rows = [];
  const now = Date.now();
  const wallets = ["wolfofshelbyyy","nniu","0x38d...d34","0x968...21e","0x593...e97","0xa65...a67","0xa33...950","0xe5f...39b"];
  for(let i=0;i<14;i++){
    const side = i%4===0 ? "BUY" : "SELL";
    const price = side==="BUY" ? 0.20 : 0.99;
    const amount = i===0 ? 1700 : (i%3===0? 267 : (i%2===0? 259: 75));
    const total = Math.round(amount * price * 100)/100;
    const ageMin = i<6 ? 1 : (i<10 ? 8 : 13);
    rows.push({ outcome: "NO", side, price, amount, total, age: ageMin+"m", trader: wallets[i%wallets.length] });
  }
  return rows;
}

function CandleMini({ candles }){
  // Simple SVG "candles": vertical lines + rectangles. Not tradingview, but enough for UI demo.
  const w = 980, h = 320, pad = 18;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const xStep = (w - pad*2) / candles.length;
  const y = (p) => {
    const t = (p - pMin) / (pMax - pMin || 1);
    return (h - pad) - t * (h - pad*2);
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%", height:"100%"}}>
      {/* grid */}
      {Array.from({length:6}).map((_,i)=>(
        <line key={i} x1={0} x2={w} y1={(h/6)*i} y2={(h/6)*i} stroke="rgba(255,255,255,0.06)" />
      ))}
      {candles.map((c, i) => {
        const x = pad + i*xStep + xStep/2;
        const o = y(c.open), cl = y(c.close), hi=y(c.high), lo=y(c.low);
        const up = c.close >= c.open;
        const bodyTop = Math.min(o, cl);
        const bodyBot = Math.max(o, cl);
        const bodyH = Math.max(2, bodyBot - bodyTop);
        const bodyW = Math.max(3, xStep*0.55);
        const color = up ? "rgba(34,211,238,0.9)" : "rgba(168,85,247,0.9)";
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={hi} y2={lo} stroke={color} strokeWidth="1.2" />
            <rect x={x-bodyW/2} y={bodyTop} width={bodyW} height={bodyH} fill={color} opacity="0.35" />
          </g>
        );
      })}
    </svg>
  );
}

export default function Page({ searchParams }) {
  const marketId = searchParams?.marketId ?? "test";
  const outcomeId = searchParams?.outcomeId ?? "yes";
  const interval = searchParams?.interval ?? "1h";
  const theme = searchParams?.theme ?? "dark";

  const candles = makeMockCandles(90);
  const ob = makeMockOrderbook();
  const trades = makeMockTrades();

  const title = outcomeId === "yes"
    ? "Will Bitcoin reach $250,000 by December 31, 2025?"
    : "Will Bitcoin NOT reach $250,000 by December 31, 2025?";

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
          <div style={{height:"340px"}}>
            <CandleMini candles={candles} />
          </div>

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
              <div className="tab">Comments</div>
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

        {/* ===== Orderbook (Polymarket-style) ===== */}
<div className="panel" style={{padding:"10px", height:"fit-content"}}>
  <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
    <div style={{fontWeight:900, fontSize:"13px"}}>Order Book ({outcomeId.toUpperCase()})</div>
    <div className="select-wrap">
      <select className="select" defaultValue="0.01">
        <option value="0.01">tick 0.01</option>
        <option value="0.005">tick 0.005</option>
        <option value="0.001">tick 0.001</option>
      </select>
    </div>
  </div>

  {/* Header columns */}
  <div style={{
    display:"grid",
    gridTemplateColumns:"88px 1fr 1fr",
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

  {(() => {
    // ---- Fix “heatmap lỗi”: dùng max cumulative để scale % chuẩn ----
    const asks = [...ob.asks].sort((a,b)=>Number(b.price)-Number(a.price)); // asks từ cao -> thấp (giống polymarket)
    const bids = [...ob.bids].sort((a,b)=>Number(b.price)-Number(a.price)); // bids từ cao -> thấp

    let cumA = 0;
    const asksCum = asks.map(r => (cumA += Number(r.total)));
    let cumB = 0;
    const bidsCum = bids.map(r => (cumB += Number(r.total)));

    const maxCum = Math.max(asksCum.at(-1) || 1, bidsCum.at(-1) || 1);

    const Row = ({ side, r, cum }) => {
      const isAsk = side === "ask";
      const pct = Math.max(0, Math.min(100, (cum / maxCum) * 100));

      return (
        <div style={{position:"relative", marginTop:"8px"}}>
          {/* depth bar bên trái */}
          <div style={{
            position:"absolute",
            left:0,
            top:0,
            bottom:0,
            width:`${pct}%`,
            borderRadius:"10px",
            background: isAsk ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.14)"
          }} />

          <div style={{
            position:"relative",
            display:"grid",
            gridTemplateColumns:"88px 1fr 1fr",
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

    // last + spread (demo)
    const lastC = Math.round((candles.at(-1)?.close ?? 0.2) * 100);
    const spreadC = 1; // demo: 1¢

    return (
      <>
        {/* Asks block */}
        <div style={{marginTop:"10px"}}>
          <div style={{display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px"}}>
            <span className="pill" style={{color:"#fff", background:"rgba(239,68,68,0.18)"}}>Asks</span>
          </div>
          {asks.map((r,i)=>(
            <Row key={"a"+i} side="ask" r={r} cum={asksCum[i]} />
          ))}
        </div>

        {/* Middle: last + spread */}
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

        {/* Bids block */}
        <div style={{marginTop:"12px"}}>
          <div style={{display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px"}}>
            <span className="pill" style={{color:"#fff", background:"rgba(34,197,94,0.18)"}}>Bids</span>
          </div>
          {bids.map((r,i)=>(
            <Row key={"b"+i} side="bid" r={r} cum={bidsCum[i]} />
          ))}
        </div>
      </>
    );
  })()}
</div>
