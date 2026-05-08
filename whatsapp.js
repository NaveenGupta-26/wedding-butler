/*****************************************************************
 👰🤵 Wedding Butler – WhatsApp Integration
 Using whatsapp-web.js
 
 Fully config-driven: reads all wedding details from data files.
 No hardcoded names, venues, or dates.
*****************************************************************/

const { Client, LocalAuth } = require('whatsapp-web.js');
const terminalQR = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const dataManager = require('./src/dataManager');
const aiService = require('./src/aiService');

let qrDataUri = null;
let onQRReceived = null;
let onStatusChange = null;

const welcomedUsers = new Set();

/**
 * Build the welcome message dynamically from config.
 */
function getWelcomeMessage() {
    const config = dataManager.getConfig();
    const events = dataManager.getEvents();
    const groomName = config.groomName || "Groom";
    const brideName = config.brideName || "Bride";
    const venue = events[0]?.location || "the wedding venue";

    return `Welcome to ${brideName} ❤️ ${groomName} Wedding 🎉\n\nI am The Wedding Butler, your personal wedding assistant.\n\nYou can ask me:\n• Venue location\n• Event timing\n• Parking info\n• Any help\n\nHappy to assist you 😊`;
}

/**
 * Build extended list of wedding keywords from config + KB for intent filtering.
 */
function getWeddingKeywords() {
    const config = dataManager.getConfig();
    const groomName = (config.groomName || "").toLowerCase();
    const brideName = (config.brideName || "").toLowerCase();

    // Core wedding terms that should ALWAYS pass
    const coreKeywords = [
        // Greetings
        'hi', 'hello', 'hey', 'namaste', 'salam', 'yo', 'hola',
        // Wedding events
        'wedding', 'shadi', 'shaadi', 'mehendi', 'mehndi', 'sangeet', 'haldi',
        'baraat', 'barat', 'phera', 'phere', 'vidai', 'reception',
        // Venue & logistics
        'venue', 'location', 'kaha', 'kahan', 'address', 'map', 'direction', 'route',
        'hotel', 'room', 'stay', 'resort', 'parking', 'car', 'gaadi',
        'pickup', 'bus', 'cab', 'transport', 'station', 'airport', 'flight',
        // Timing
        'time', 'kab', 'timing', 'schedule', 'date', 'kitne baje', 'program',
        // Food & drink
        'food', 'khana', 'menu', 'dinner', 'lunch', 'breakfast', 'drink', 'bar',
        'alcohol', 'daaru', 'cocktail', 'nashta', 'snack',
        // Dress & appearance
        'dress', 'wear', 'outfit', 'theme', 'color', 'code',
        // Help & emergencies
        'help', 'madad', 'otp', 'code', 'sos', 'emergency', 'doctor', 'medicine',
        'problem', 'issue', 'nahi', 'kharab', 'complaint',
        // Fun & engagement
        'dance', 'song', 'gaana', 'dj', 'party', 'maza', 'fun', 'boring', 'bore',
        'joke', 'mazak', 'quiz', 'dare', 'game', 'selfie',
        // People
        'dulha', 'dulhan', 'groom', 'bride', 'ladka', 'ladki',
        // General
        'thank', 'shukriya', 'dhanyavaad', 'ok', 'acha', 'thik',
        'wifi', 'password', 'washroom', 'toilet', 'pool', 'spa',
        'kids', 'baby', 'bache', 'elder', 'parents',
        'checkin', 'checkout', 'laundry', 'iron',
        // Couple questions
        'love story', 'honeymoon', 'propose', 'shagun', 'gift',
        // Butler personality
        'single', 'cute', 'number', 'hug', 'kiss',
        // Weather, network
        'weather', 'garmi', 'network', 'signal',
    ];

    // Add couple names dynamically
    if (groomName) coreKeywords.push(groomName);
    if (brideName) coreKeywords.push(brideName);

    return coreKeywords;
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "wedding-butler"
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--no-zygote',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-setuid-sandbox',
            '--js-flags="--max-old-space-size=256"',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--single-process'
        ]
    }
});

client.on('qr', async (qr) => {
    console.log('\n[WHATSAPP] New QR Code Received. Scanning this might be easier in the Admin Panel.\n');
    terminalQR.generate(qr, { small: true });

    // Generate Data URI for Socket
    qrDataUri = await QRCode.toDataURL(qr);

    // Save to file for direct access
    const qrPath = path.join(__dirname, 'public', 'qr.png');
    const base64Data = qrDataUri.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(qrPath, base64Data, 'base64');

    if (onQRReceived) onQRReceived(qrDataUri);
});

client.on('ready', () => {
    console.log('\n✅ Wedding Butler is Online!\n');
    if (onStatusChange) onStatusChange('Connected');
});

client.on('disconnected', (reason) => {
    console.error('[WHATSAPP] Disconnected:', reason);
    if (onStatusChange) onStatusChange('Disconnected');
    
    // Auto-reconnect after 5 seconds
    setTimeout(() => {
        console.log('[WHATSAPP] Attempting reconnection...');
        client.initialize().catch(e => {
            console.error('[WHATSAPP] Reconnection failed:', e.message);
        });
    }, 5000);
});

client.on('message', async (message) => {
    try {
        // 1. HARD PRIVACY GUARDS
        if (message.from === 'status@broadcast' || message.from.includes('@g.us') || message.fromMe) {
            return;
        }

        // Only respond to text messages
        if (message.type !== 'chat') return;

        const phone = message.from.replace('@c.us', '');
        let text = message.body ? message.body.trim() : "";

        // 1.5 MEDIA GUARD (B4)
        let mediaUrl = null;
        if (message.hasMedia) {
            try {
                const media = await message.downloadMedia();
                if (media) {
                    const filename = `media_${Date.now()}.${media.mimetype.split('/')[1]}`;
                    const mediaPath = path.join(__dirname, 'public', 'media', filename);
                    
                    // Ensure media dir exists
                    const mediaDir = path.join(__dirname, 'public', 'media');
                    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

                    fs.writeFileSync(mediaPath, media.data, 'base64');
                    mediaUrl = `/media/${filename}`;
                    text = `[Sent a Photo: ${mediaUrl}] ${text}`;
                    console.log(`[WHATSAPP] Media saved: ${mediaUrl}`);
                }
            } catch (e) {
                console.error("[WHATSAPP] Media download failed:", e.message);
            }
        }

        // 2. GUEST-ONLY GUARD: Strict check against Guest List
        let guest = dataManager.getGuestByPhone(phone);
        const TRIAL_MODE = process.env.TRIAL_MODE !== 'false'; // Default to true unless explicitly disabled

        if (!guest) {
            if (TRIAL_MODE) {
                console.log(`[WHATSAPP-AUTH] Trial Mode: Auto-registering ${phone}`);
                guest = {
                    id: `g_trial_${phone.replace(/\D/g, '')}`,
                    name: `Guest (${phone.slice(-4)})`,
                    phone: `+${phone}`,
                    relation: 'Trial Tester',
                    category: 'friend',
                    side: 'Both',
                    isTrial: true,
                    lifecycleStage: 'arrived'
                };
                await dataManager.addGuest(guest);
            } else {
                console.log(`[WHATSAPP-PRIVACY] Ignoring message from unknown number: ${phone}`);
                return;
            }
        }

        console.log(`[WHATSAPP] Authorized msg from ${guest.name}: "${text}"`);

        // 3. INTENT GUARD: Check for wedding-related content
        const weddingKeywords = getWeddingKeywords();
        const lowerText = text.toLowerCase();
        // Allow: short messages (greetings), any keyword match, or questions (?)
        const hasWeddingIntent = lowerText.length < 15 || 
            weddingKeywords.some(k => lowerText.includes(k)) ||
            lowerText.includes('?');

        if (!hasWeddingIntent) {
            console.log(`[WHATSAPP-PRIVACY] Ignoring message from ${guest.name} as it lacks wedding intent.`);
            return;
        }

        // 4. Consulting AI
        const eventContext = { events: dataManager.getEvents() };
        const isFirstTime = !welcomedUsers.has(phone);
        if (isFirstTime) welcomedUsers.add(phone);

        // Notify Server that AI is thinking
        if (module.exports.onTyping) {
            module.exports.onTyping({ guestId: guest.id, typing: true });
        }

        const aiResult = await aiService.answerQuery(text, guest, eventContext);

        // Stop typing
        if (module.exports.onTyping) {
            module.exports.onTyping({ guestId: guest.id, typing: false });
        }

        // 5. Save and Notify Server (for Admin Panel)
        const guestMsgObj = {
            sender: 'You',
            text: text,
            type: 'incoming',
            timestamp: new Date().toLocaleTimeString()
        };
        await dataManager.addChatMessage(guest.id, guestMsgObj);

        if (module.exports.onMessageReceived) {
            module.exports.onMessageReceived({
                guestId: guest.id,
                guestName: guest.name,
                message: text,
                urgency: aiResult ? aiResult.type : 'normal',
                timestamp: guestMsgObj.timestamp
            });
        }

        if (aiResult && aiResult.text) {
            let finalOutput = aiResult.text;
            const isGreeting = lowerText.length < 5 && (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('namaste'));

            if (isFirstTime && isGreeting && !finalOutput.includes('Welcome')) {
                finalOutput = getWelcomeMessage() + "\n\n" + finalOutput;
            }

            // B1: Append Quick Replies text only for starting chat or help-related questions
            const helpKeywords = ["help", "madad", "assist", "kya karu", "kaise", "what can you do"];
            const isHelpRequest = helpKeywords.some(k => lowerText.includes(k));
            
            if (isFirstTime || isGreeting || isHelpRequest) {
                const quickReplies = "\n\n*Quick Check:*\nReply with:\n'Schedule' 📅\n'Food' 🍛\n'Venue' 📍\n'Help' 🛎";
                finalOutput += quickReplies;
            }

            await client.sendMessage(message.from, finalOutput);
            console.log(`[WHATSAPP] Replied to ${guest.name} ✅`);

            // Save AI reply to history
            await dataManager.addChatMessage(guest.id, {
                sender: 'The Wedding Butler',
                text: finalOutput,
                type: 'outgoing',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }

    } catch (error) {
        console.error("[WHATSAPP] Error:", error.message);
    }
});

// Broadcast Function
async function broadcastMessage(text, targetPhones = null) {
    const guests = dataManager.getGuests();
    let sentCount = 0;

    for (const guest of guests) {
        try {
            if (guest.phone) {
                // If targetPhones is provided, skip guests not in the list
                if (targetPhones && !targetPhones.includes(guest.phone)) continue;

                const chatId = guest.phone.replace('+', '') + "@c.us";
                const personalizedMsg = await aiService.personalizeBroadcast(text, guest, { events: dataManager.getEvents() });
                await client.sendMessage(chatId, personalizedMsg);

                // Save to history
                await dataManager.addChatMessage(guest.id, {
                    sender: 'The Wedding Butler',
                    text: personalizedMsg,
                    type: 'outgoing',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });

                sentCount++;
                // Add a small delay to avoid memory spikes and rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (e) {
            console.error(`[WHATSAPP] Failed to send broadcast to ${guest.name}:`, e.message);
        }
    }
    console.log(`[WHATSAPP] Broadcast sent to ${sentCount} guests.`);
    return sentCount;
}

module.exports = {
    client,
    broadcastMessage,
    onMessageReceived: null,
    onTyping: null,
    getQR: () => qrDataUri,
    setQRCallback: (cb) => { onQRReceived = cb; },
    setStatusCallback: (cb) => { onStatusChange = cb; }
};
