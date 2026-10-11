const axios = require('axios');

async function testVercelStream() {
  const url = 'https://kirmalk-addon.vercel.app/stream/series/km_s_bc1341b69:1:1:bc1341b69.json';
  console.log('Querying:', url);
  try {
    const res = await axios.get(url);
    console.log('Status:', res.status);
    console.log('Data:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log('Error:', e.message, e.response?.data);
  }
}

testVercelStream();
