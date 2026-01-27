// debug-market.js
async function check() {
  const res = await fetch('http://localhost:3000/api/opinion/market/3247');
  const json = await res.json();
  const data = json?.result?.data;
  
  console.log('=== Opinion Market 3247 ===');
  console.log('title:', data?.title);
  console.log('tittle:', data?.tittle);
  console.log('name:', data?.name);
  console.log('question:', data?.question);
  console.log('yesTokenId:', data?.yesTokenId);
  console.log('noTokenId:', data?.noTokenId);
  console.log('\nAll keys:', Object.keys(data || {}).join(', '));
}
check();
