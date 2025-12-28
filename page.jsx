export default function Home(){
  return (
    <div className="panel" style={{padding:"14px"}}>
      <div style={{fontWeight:900, fontSize:"14px"}}>Opinion Chart Service (Demo)</div>
      <p className="muted" style={{marginTop:"8px"}}>
        Mở iframe demo tại: <span className="mono">/embed/kline?marketId=test&outcomeId=yes&interval=1h&theme=dark</span>
      </p>
    </div>
  );
}
