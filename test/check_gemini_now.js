require('dotenv').config();
const https = require('https');

const apiKey = process.env.GEMINI_API_KEY;
const data = JSON.stringify({
    contents: [{ parts: [{ text: "Hi" }] }]
});

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log(`Checking Gemini API Status...`);

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(body);
            if (res.statusCode === 200) {
                console.log("✅ STATUS: WORKING! (200 OK)");
                console.log("Response:", parsed.candidates[0].content.parts[0].text.trim());
            } else if (res.statusCode === 429) {
                console.log("❌ STATUS: QUOTA EXCEEDED (429)");
                console.log("Message:", parsed.error.message);
            } else {
                console.log(`❌ STATUS: ERROR (${res.statusCode})`);
                console.log("Error:", JSON.stringify(parsed, null, 2));
            }
        } catch (e) {
            console.log('Raw Body:', body);
        }
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(data);
req.end();
