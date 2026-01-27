// Quick test fetch
async function test() {
  try {
    console.log("Fetching...");
    const res = await fetch("http://localhost:3000/api/arbitage/opportunities?debug=1");
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
