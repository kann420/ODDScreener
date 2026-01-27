// test-sync.js - Write response to file for inspection
const fs = require('fs');
const https = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/arbitage/opportunities?mode=manual',
  method: 'GET'
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('test-output.json', data);
    console.log('Response saved to test-output.json');
    
    try {
      const parsed = JSON.parse(data);
      console.log('Rows:', parsed.rows?.length || 0);
      if (parsed.rows?.length) {
        parsed.rows.forEach((r, i) => {
          console.log(`[${i+1}] ${r.title} - ${r.arbPct?.toFixed(2)}%`);
        });
      }
      console.log('\nDebug entries:', parsed.debug?.length || 0);
      // Show prices_before_compute step
      const priceDebug = parsed.debug?.filter(d => d.step === 'prices_before_compute');
      if (priceDebug?.length) {
        console.log('\nPrice debug:');
        priceDebug.forEach(p => {
          console.log(JSON.stringify(p, null, 2));
        });
      }
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });
});

req.on('error', e => console.error('Request error:', e.message));
req.end();
