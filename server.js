const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const schedule = require('node-schedule');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// PostgreSQL Connection Context
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL) {
    console.log('[DB] DATABASE_URL found. PostgreSQL will be used for persistence.');
} else {
    console.warn('[DB] ⚠️ No DATABASE_URL found. Falling back to local JSON storage.');
}

// Global Config
const TRIAL_MODE = process.env.TRIAL_MODE === 'true' || true; // Using true by default as requested
if (TRIAL_MODE) console.log('[CONFIG] 🧪 TRIAL MODE is ENABLED. Non-guests can test the butler.');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[STARTUP] Created data/ directory');
}

// Internal Modules
const dataManager = require('./src/dataManager');
const aiService = require('./src/aiService');
const deliveryService = require('./src/deliveryService');
const schedulerService = require('./src/schedulerService');
const smsService = require('./src/smsService');
const { normalizePhone, phonesMatch } = require('./src/utils');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Admin Credentials (In a real app, use .env)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'butler123';

// Middleware
app.use(express.json());
app.use(cors());
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'wedding_butler_super_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// Rate limiters
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { success: false, message: 'Too many OTP requests. Try again later.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, message: 'Too many login attempts. Try again later.' } });

// Protect admin files — serve them only for authenticated admins
app.get('/admin.html', (req, res) => {
    if (req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/admin-login.html');
    }
});
app.get('/admin.js', (req, res) => {
    if (req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public', 'admin.js'));
    } else {
        res.status(401).send('Unauthorized');
    }
});

// Serve guest app index.html with dynamic config injection
const serveIndex = (req, res) => {
    const config = dataManager.getConfig();
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    // Inject dynamic couple names
    html = html.replace(/\{\{GROOM_NAME\}\}/g, config.groomName || 'Groom');
    html = html.replace(/\{\{BRIDE_NAME\}\}/g, config.brideName || 'Bride');
    html = html.replace(/\{\{HOST_NAME\}\}/g, config.hostName || `${config.groomName} & ${config.brideName}`);
    html = html.replace(/\{\{WEDDING_HASHTAG\}\}/g, config.weddingHashtag || '');
    res.send(html);
};

app.get('/', serveIndex);
app.get('/index.html', serveIndex);

app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    // Block direct access to admin files via static middleware
    setHeaders: (res, filePath) => {},
    index: false // We serve index.html manually via the routes above
}));

// Auth Middleware
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ success: false, message: "Unauthorized" });
    }
};

// --- WHATSAPP BUTLER ---
const whatsappButler = require('./whatsapp');

whatsappButler.setQRCallback((qrUri) => {
    io.to('host_room').emit('whatsapp_qr', { qr: qrUri });
});

whatsappButler.setStatusCallback((status) => {
    io.to('host_room').emit('whatsapp_status', { status });
});

// Initialize Data
dataManager.init().then(() => {
    console.log('[DATA] DataManager ready.');
    whatsappButler.client.initialize();
});

// Register WhatsApp typing callback

// Register WhatsApp typing callback
whatsappButler.onTyping = (data) => {
    console.log(`[SERVER] WhatsApp Typing for Guest ${data.guestId}: ${data.typing}`);
    io.to('host_room').emit('butler_typing', data);
};

// Register WhatsApp incoming message callback for Admin Panel
whatsappButler.onMessageReceived = (data) => {
    const { guestId, guestName, message, urgency, timestamp } = data;

    // 1. Emit Activity (to update chat list/window)
    io.to('host_room').emit('guest_activity', {
        guestId,
        guestName,
        message,
        timestamp
    });

    // 2. Emit Status Update (Badge)
    let status = 'normal';
    let label = 'New Msg 📩';

    if (urgency === 'serious') {
        status = 'serious';
        label = 'Urgent Help 🚨';
    } else if (urgency === 'admin_help') {
        status = 'admin_help';
        label = 'Need Admin ⚠️';
    }

    io.to('host_room').emit('guest_status_update', {
        guestId,
        status,
        label
    });
};

// --- APIs ---

// Admin Login API
app.post('/api/admin-login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

// Admin Logout
app.post('/api/admin-logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check Auth Status
app.get('/api/admin-check', (req, res) => {
    res.json({ isAdmin: !!req.session.isAdmin });
});

app.get('/api/whatsapp-status', async (req, res) => {
    try {
        const state = await whatsappButler.client.getState().catch(() => 'DISCONNECTED');
        res.json({ state });
    } catch (err) {
        res.json({ state: 'ERROR', message: err.message });
    }
});

// Debug endpoint (Public during troubleshooting)
app.get('/debug-state', (req, res) => {
    res.json({
        dbConnected: dataManager.isDBConnected,
        guestCount: dataManager.getGuests().length,
        chatKeys: Object.keys(dataManager.getChats()),
        guestIds: dataManager.getGuests().map(g => g.id)
    });
});

// --- OTP STORAGE ---
const otpStore = new Map(); // phone -> { otp, expires }
const OTP_EXPIRY_MINUTES = 5;

// Cleanup expired OTPs every 10 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [phone, data] of otpStore) {
        if (now > data.expires) otpStore.delete(phone);
    }
}, 10 * 60 * 1000);

function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// --- GUEST-SIDE APIs ---
// 1. Guest Login (OTP) - Leaving public for guest app
app.post('/api/login', otpLimiter, async (req, res) => {
    console.log(`[API] POST /api/login hit`);
    let { phone } = req.body;

    // Normalize phone for consistency
    console.log(`[AUTH] Normalizing phone: ${phone}`);
    phone = normalizePhone(phone);
    console.log(`[AUTH] Normalized phone: ${phone}`);

    // Find guest by phone
    let guest = dataManager.getGuests().find(g => {
        const match = phonesMatch(g.phone, phone);
        if (match) console.log(`[AUTH] Match found for guest: ${g.name} (${g.phone})`);
        return match;
    });

    if (!guest) {
        if (TRIAL_MODE) {
            console.log(`[AUTH] Creating TRIAL GUEST for ${phone}`);
            guest = {
                id: `g_trial_${phone.replace(/\D/g, '')}`,
                name: `Guest (${phone.slice(-4)})`,
                phone: phone,
                relation: 'Trial Tester',
                category: 'friend',
                side: 'Both',
                isTrial: true,
                lifecycleStage: 'arrived'
            };
            await dataManager.addGuest(guest);
        } else {
            return res.status(404).json({ success: false, message: "Phone number not found in Guest List." });
        }
    }

    const otp = generateOTP();
    const expires = Date.now() + (OTP_EXPIRY_MINUTES * 60 * 1000);
    otpStore.set(phone, { otp, expires });

    console.log(`[AUTH] OTP for ${guest.name} (${phone}): ${otp}`);

    // Send via WhatsApp
    try {
        const whatsappId = phone.replace('+', '') + "@c.us";
        console.log(`[AUTH] Attempting WhatsApp OTP to ${whatsappId}...`);

        // Check state with a 5s timeout
        const state = await Promise.race([
            whatsappButler.client.getState(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]).catch(() => 'DISCONNECTED');

        console.log(`[AUTH] WhatsApp Butler State: ${state}`);

        if (state === 'CONNECTED') {
            await whatsappButler.client.sendMessage(whatsappId, `Your Wedding Butler OTP is: ${otp}. Valid for 5 minutes.`);
            console.log(`[AUTH] WhatsApp OTP sent successfully to ${phone} ✅`);
        } else {
            console.warn(`[AUTH] ⚠️ WhatsApp NOT CONNECTED. Please scan QR in Admin. OTP displayed in terminal only.`);
        }
    } catch (err) {
        console.error(`[AUTH] ❌ WhatsApp Error:`, err.message);
    }

    // Optional SMS (Non-blocking)
    smsService.sendOTP(phone, otp).catch(() => { });

    res.json({
        success: true,
        message: "OTP Sent! Please check your WhatsApp."
    });
});

app.post('/api/login-password', async (req, res) => {
    let { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ success: false, message: "Phone and Password required" });

    // Normalize phone
    phone = normalizePhone(phone);
    const MASTER_PASSWORD = process.env.ADMIN_PASSWORD || "naveenwedding";

    // Find guest
    const guest = dataManager.getGuests().find(g => phonesMatch(g.phone, phone));

    if (!guest) {
        return res.status(404).json({ success: false, message: "Phone number not found in Guest List." });
    }

    if (password === MASTER_PASSWORD) {
        // Success
        req.session.guestPhone = phone;
        req.session.guestId = guest.id;
        
        console.log(`[AUTH] Password Login SUCCESS for ${guest.name} (${phone}) ✅`);
        
        res.json({
            success: true,
            guest: {
                id: guest.id,
                name: guest.name,
                phone: guest.phone,
                side: guest.side,
                status: guest.status
            }
        });
    } else {
        console.log(`[AUTH] Password Login FAILED for ${guest.name} (Wrong Password) ❌`);
        res.status(401).json({ success: false, message: "Incorrect password." });
    }
});

app.get('/api/login-demo', async (req, res) => {
    console.log(`[API] GET /api/login-demo hit`);
    
    const demoPhone = '+910000000000';
    // Use exact phone match to avoid false positives with phonesMatch endsWith logic
    let guest = dataManager.getGuests().find(g => g.phone === demoPhone);

    if (!guest) {
        console.log(`[AUTH] Creating DEMO TRIAL GUEST`);
        guest = {
            id: `g_demo_${Date.now()}`,
            name: `Trial Guest`,
            phone: demoPhone,
            relation: 'Trial Tester',
            category: 'elder',
            side: 'Both',
            language_preference: 'elder',
            isTrial: true,
            lifecycleStage: 'arrived'
        };
        await dataManager.addGuest(guest);
    } else {
        // Ensure properties are correct even if guest exists
        guest.name = 'Trial Guest';
        guest.category = 'elder';
        guest.language_preference = 'elder';
        guest.isTrial = true;
        await dataManager.updateGuest(guest.id, { 
            name: 'Trial Guest', 
            category: 'elder', 
            language_preference: 'elder', 
            isTrial: true 
        });
    }

    console.log(`[AUTH] Demo Login SUCCESS for ${guest.name} ✅`);

    res.json({
        success: true,
        guest: {
            id: guest.id,
            name: guest.name,
            phone: guest.phone,
            side: guest.side,
            category: guest.category,
            language_preference: guest.language_preference
        }
    });
});

app.post('/api/verify', (req, res) => {
    let { phone, otp } = req.body;

    // Normalize phone
    phone = normalizePhone(phone);

    const stored = otpStore.get(phone);

    if (!stored) {
        return res.status(401).json({ success: false, message: "No OTP requested for this number." });
    }

    if (Date.now() > stored.expires) {
        otpStore.delete(phone);
        return res.status(401).json({ success: false, message: "OTP has expired." });
    }

    if (stored.otp === otp) {
        otpStore.delete(phone); // Burn after use
        const guest = dataManager.getGuests().find(g => phonesMatch(g.phone, phone));
        return res.json({ success: true, guest: guest });
    }

    res.status(401).json({ success: false, message: "Invalid OTP" });
});

// 2. Data Access - PROTECTED FOR ADMIN
app.get('/api/guests', isAdmin, (req, res) => {
    res.json(dataManager.getGuests());
});

app.get('/api/wedding-context', (req, res) => {
    // Return base wedding context (public info like SOS number)
    try {
        const contextPath = path.join(__dirname, 'data', 'weddingContext.json');
        const context = JSON.parse(fs.readFileSync(contextPath));
        res.json(context);
    } catch (e) {
        res.status(500).json({ success: false, message: "Error loading context" });
    }
});

app.get('/api/config', (req, res) => {
    // Returns full wedding config and events list
    res.json({
        config: dataManager.getConfig(),
        events: dataManager.getEvents()
    });
});

app.post('/api/wedding-context', isAdmin, (req, res) => {
    try {
        const contextPath = path.join(__dirname, 'data', 'weddingContext.json');
        const currentContext = JSON.parse(fs.readFileSync(contextPath));

        // Update fields if provided
        if (req.body.emergencyContact) {
            currentContext.emergencyContact = req.body.emergencyContact;
        }

        fs.writeFileSync(contextPath, JSON.stringify(currentContext, null, 2));
        res.json({ success: true, message: "Settings updated" });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error saving context" });
    }
});



app.post('/api/add-guest', isAdmin, async (req, res) => {
    let { name, phone, relation, category, side, hotel, isVIP } = req.body;
    if (!name || !phone) {
        return res.json({ success: false, message: "Name and Phone required" });
    }

    // ✅ Normalize phone number (India default +91)
    phone = normalizePhone(phone);

    const newGuest = {
        id: `g_${Date.now()}`,
        name,
        phone,
        relation: relation || 'Guest',
        category: category || 'friend',
        language_preference: 'hinglish_polite',
        side: side || 'Groom',
        hotel: hotel || 'Royal Pepper Resort',
        isVIP: !!isVIP
    };

    await dataManager.addGuest(newGuest);
    res.json({ success: true, guest: newGuest });
});

// --- PROACTIVE BUTLER APIS ---
app.post('/api/admin/proactive-mode', isAdmin, (req, res) => {
    const { mode } = req.body;
    if (!['manual', 'hybrid', 'auto'].includes(mode)) {
        return res.json({ success: false, message: "Invalid mode" });
    }
    schedulerService.setMode(mode);
    res.json({ success: true, mode });
});

app.post('/api/admin/kill-switch', isAdmin, (req, res) => {
    console.log("[ADMIN] 🚨 EMERGENCY KILL SWITCH REQUESTED");
    schedulerService.kill();
    res.json({ success: true, message: "Butler disabled immediately." });
});

app.post('/api/admin/send-proactive', isAdmin, (req, res) => {
    const { guestId, intent, context } = req.body;
    const guest = dataManager.getGuestById(guestId);
    if (!guest) return res.json({ success: false, message: "Guest not found" });

    schedulerService.executeProactiveMessage(guest, { intent, context, eventId: 'manual' });
    res.json({ success: true, message: "Proactive message queued" });
});


app.post('/api/delete-guest', isAdmin, async (req, res) => {
    const { id } = req.body;
    await dataManager.deleteGuest(id);
    res.json({ success: true });
});

// 3. Training API - PROTECTED
app.post('/api/train', isAdmin, (req, res) => {
    const { question, answer } = req.body;
    // Extract keywords (remove punctuation, then split)
    const cleanQ = question.replace(/[^\w\s]/gi, '');
    const keywords = cleanQ.split(' ').filter(w => w.length > 3).map(w => w.toLowerCase());

    aiService.train(keywords, answer);
    res.json({ success: true, message: "AI Trained successfully" });
});

// --- CHAT HISTORY & MANAGEMENT ---
app.get('/api/chats/:guestId', isAdmin, (req, res) => {
    const chats = dataManager.getChatsByGuestId(req.params.guestId);
    res.json(chats);
});

// Guest History Retrieval (used by index.html)
app.get('/api/my-chats/:phone', (req, res) => {
    let { phone } = req.params;
    if (!phone) return res.json([]);

    // Normalize phone
    phone = normalizePhone(phone);

    const guest = dataManager.getGuestByPhone(phone);
    if (!guest) return res.json([]);

    const chats = dataManager.getChatsByGuestId(guest.id);
    res.json(chats);
});

app.post('/api/chats/clear/:guestId', isAdmin, async (req, res) => {
    await dataManager.clearChatsForGuest(req.params.guestId);
    res.json({ success: true, message: "Chat history cleared" });
});

app.post('/api/chats/clear-all', isAdmin, async (req, res) => {
    await dataManager.clearAllChats();
    res.json({ success: true, message: "All chat histories cleared" });
});

// Guest-side: Clear own chat
app.post('/api/my-chats/clear', async (req, res) => {
    console.log(`[API] POST /api/my-chats/clear hit`);
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone required" });

    // Normalize phone
    const finalPhone = normalizePhone(phone);

    console.log(`[API] Clearing chat for guest with phone: ${finalPhone}`);
    const guest = dataManager.getGuestByPhone(finalPhone);
    if (!guest) {
        console.warn(`[API] Guest not found for phone: ${finalPhone}`);
        return res.status(404).json({ success: false, message: "Guest not found" });
    }

    await dataManager.clearChatsForGuest(guest.id);
    console.log(`[API] Chat cleared for guest: ${guest.name} (${guest.id})`);
    res.json({ success: true, message: "Chat cleared" });
});

// Guest-side: Delete specific messages
app.post('/api/my-chats/delete', async (req, res) => {
    console.log(`[API] POST /api/my-chats/delete hit`);
    const { phone, messageIds } = req.body;
    if (!phone || !messageIds) return res.status(400).json({ success: false, message: "Phone and messageIds required" });

    // Normalize phone
    const finalPhone = normalizePhone(phone);

    const guest = dataManager.getGuestByPhone(finalPhone);
    if (!guest) return res.status(404).json({ success: false, message: "Guest not found" });

    await dataManager.deleteMessages(guest.id, messageIds);
    res.json({ success: true, message: "Messages deleted" });
});

// --- REAL-TIME SOCKET ---
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join Room
    socket.on('join', (data) => {
        if (data.role === 'host') {
            socket.join('host_room');
            console.log("Host joined");

            // Send current QR if available
            const currentQR = whatsappButler.getQR();
            if (currentQR) {
                socket.emit('whatsapp_qr', { qr: currentQR });
            }
        } else if (data.role === 'guest') {
            socket.join(`guest_${data.id}`);
            console.log(`Guest ${data.id} joined`);
        }
    });

    // HOST: Broadcast
    socket.on('host_send_broadcast', async (data) => {
        const { message, filters } = data;

        const guests = dataManager.getGuests();
        const eventContext = { events: dataManager.getEvents() };

        // 1. Filter Guests
        const targetGuests = guests.filter(g => {
            if (!filters) return true; // Default to all if no filters provided
            const matchSide = filters.side === 'all' || g.side === filters.side;
            const matchStatus = filters.status === 'all' ||
                (filters.status === 'vip' && g.isVIP) ||
                (filters.status === 'regular' && !g.isVIP);
            const matchCategory = filters.category === 'all' || g.category === filters.category;
            return matchSide && matchStatus && matchCategory;
        });

        console.log(`[BROADCAST] Sending to ${targetGuests.length} guests out of ${guests.length}`);

        // 2. Send via WhatsApp (Global or Targeted?)
        // For simplicity in trial, we send to everyone via WhatsApp but only personalize/emit via Socket for targeted
        // Alternatively, we could update whatsappButler to handle targeted. For now, let's keep it simple.
        if (filters && (filters.side !== 'all' || filters.status !== 'all' || filters.category !== 'all')) {
            console.log("[BROADCAST] Targeted broadcast. WhatsApp global skipped to avoid spam. Only using socket.");
        } else {
            whatsappButler.broadcastMessage(message);
        }

        for (const guest of targetGuests) {
            try {
                const personalizedMsg = await aiService.personalizeBroadcast(message, guest, eventContext);

                const msgObj = {
                    sender: 'The Wedding Butler',
                    text: personalizedMsg,
                    type: 'outgoing',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };

                io.to(`guest_${guest.id}`).emit('receive_message', msgObj);

                // Save to persistence
                await dataManager.addChatMessage(guest.id, msgObj);

                // Feedback to Host
                io.to('host_room').emit('delivery_status', {
                    guestId: guest.id,
                    status: 'sent',
                    personalizedPreview: personalizedMsg
                });
            } catch (err) {
                console.error(`[BROADCAST] Error sending to ${guest.name}:`, err.message);
            }
        }
    });

    // HOST: Direct Reply (Overrides AI)
    socket.on('host_direct_reply', async (data) => {
        const { guestId, text } = data;
        const config = dataManager.getConfig();
        const hostLabel = `Host (${config.groomName || 'Host'})`;
        const msgObj = {
            sender: hostLabel,
            text: text,
            type: 'outgoing',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        io.to(`guest_${guestId}`).emit('receive_message', msgObj);
        await dataManager.addChatMessage(guestId, msgObj);

        // Also send via WhatsApp so guest gets it on their phone
        const guest = dataManager.getGuestById(guestId);
        if (guest && guest.phone) {
            try {
                const chatId = guest.phone.replace('+', '') + '@c.us';
                await whatsappButler.client.sendMessage(chatId, text);
                console.log(`[HOST-REPLY] Sent via WhatsApp to ${guest.name} ✅`);
            } catch (e) {
                console.error(`[HOST-REPLY] WhatsApp send failed for ${guest.name}:`, e.message);
            }
        }
    });

    // GUEST: Send Message
    socket.on('guest_send_message', async (data) => {
        console.log("[SERVER] Received Guest Msg:", data);
        const { guestId, message } = data;
        const guest = dataManager.getGuestById(guestId);

        if (!guest) {
            console.error(`[SERVER] Guest not found for ID: ${guestId}`);
            // Optionally emit an error back to client
            return;
        }

        const eventContext = { events: dataManager.getEvents() };

        // 1. Save and Notify Host Immediately
        const guestMsgObj = {
            sender: 'You',
            text: message,
            type: 'incoming',
            timestamp: new Date().toLocaleTimeString()
        };
        await dataManager.addChatMessage(guest.id, guestMsgObj);

        io.to('host_room').emit('guest_activity', {
            guestId: guest.id,
            guestName: guest.name,
            message: message,
            timestamp: guestMsgObj.timestamp
        });

        // --- LIFECYCLE TRIGGER: Arrived ---
        if (guest.lifecycleStage === 'invited') {
            await dataManager.updateGuest(guest.id, { lifecycleStage: 'arrived' });
            console.log(`[LIFECYCLE] ${guest.name} marked as ARRIVED`);
        }

        // 2. AI Attempt
        try {
            // Notify UI that AI is thinking
            console.log(`[SERVER] Emitting butler_typing START for guest_${guest.id}`);
            io.to(`guest_${guest.id}`).emit('butler_typing', { typing: true });
            io.to('host_room').emit('butler_typing', { guestId: guest.id, typing: true });

            const aiResult = await aiService.answerQuery(message, guest, eventContext);
            console.log("[SERVER] AI Response Object:", aiResult);

            if (aiResult && aiResult.text) {
                setTimeout(async () => {
                    try {
                        // Stop typing indicator right before showing message
                        console.log(`[SERVER] Emitting butler_typing STOP for guest_${guest.id}`);
                        io.to(`guest_${guest.id}`).emit('butler_typing', { typing: false });
                        io.to('host_room').emit('butler_typing', { guestId: guest.id, typing: false });

                        const aiMsgObj = {
                            sender: 'The Wedding Butler',
                            text: aiResult.text,
                            type: 'outgoing',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        };

                        await dataManager.addChatMessage(guest.id, aiMsgObj);
                        io.to(`guest_${guest.id}`).emit('receive_message', aiMsgObj);

                        // Log AI response to host
                        io.to('host_room').emit('ai_log', {
                            guestId: guest.id,
                            response: aiResult.text
                        });

                        // --- STATUS UPDATE TO HOST ---
                        let status = 'normal';
                        let label = 'New Msg 📩';
                        if (aiResult.type === 'serious') {
                            status = 'serious';
                            label = 'Urgent Help 🚨';
                        } else if (aiResult.type === 'admin_help') {
                            status = 'admin_help';
                            label = 'Need Admin ⚠️';
                        }

                        io.to('host_room').emit('guest_status_update', {
                            guestId: guest.id,
                            status: status,
                            label: label
                        });
                    } catch (e) {
                        console.error("[SERVER] Error in AI response timeout:", e);
                    }
                }, 1000);
            } else {
                console.warn("[SERVER] AI returned empty text!");
                setTimeout(async () => {
                    io.to(`guest_${guest.id}`).emit('butler_typing', { typing: false });
                    io.to('host_room').emit('butler_typing', { guestId: guest.id, typing: false });

                    const msg = {
                        sender: 'The Wedding Butler',
                        text: "Sorry, mujhe samajh nahi aaya 🙏 Please ek baar phir se poochein ya alag tarike se poochein!",
                        type: 'outgoing',
                        timestamp: new Date().toLocaleTimeString()
                    };
                    io.to(`guest_${guest.id}`).emit('receive_message', msg);
                    await dataManager.addChatMessage(guest.id, msg);
                }, 1000);
            }
        } catch (err) {
            console.error("[SERVER] AI Service Error:", err.stack || err);
            io.to(`guest_${guest.id}`).emit('butler_typing', { typing: false });
            io.to('host_room').emit('butler_typing', { guestId: guest.id, typing: false });

            const crashMsg = {
                sender: 'The Wedding Butler',
                text: "Oof! Thoda network issue hai. Please ask again!",
                error_detail: process.env.NODE_ENV !== 'production' ? err.message : undefined,
                type: 'outgoing',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            io.to(`guest_${guest.id}`).emit('receive_message', crashMsg);
            await dataManager.addChatMessage(guest.id, crashMsg);
        }
    });

    socket.on('guest_emergency_contact', (data) => {
        console.log(`[SOS] 🚨 EMERGENCY ALERT From ${data.guestName} (${data.phone})`);

        io.to('host_room').emit('emergency_alert', {
            guestId: data.guestId,
            guestName: data.guestName,
            phone: data.phone,
            timestamp: new Date().toLocaleTimeString()
        });

        // Also update guest status to host
        io.to('host_room').emit('guest_status_update', {
            guestId: data.guestId,
            status: 'need_help',
            label: '🚨 EMERGENCY SOS 🚨'
        });
    });

    socket.on('disconnect', () => { });
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
    console.log(`\n>>> The Wedding Butler AI Simulator running on port ${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`>>> ADMIN PANEL: http://localhost:${PORT}/admin-login.html`);
        console.log(`>>> Guest App:  http://localhost:${PORT}/index.html\n`);
    }
});



app.post('/api/update-guest', isAdmin, async (req, res) => {
    let { id, name, phone, relation, category, side, hotel, isVIP, engagementLevel, lifecycleStage } = req.body;
    if (!id) {
        return res.json({ success: false, message: "Guest ID required" });
    }

    // Normalize phone (+91 default)
    if (phone) {
        phone = normalizePhone(phone);
    }

    const success = await dataManager.updateGuest(id, { 
        name, phone, relation, category, side, hotel, isVIP, engagementLevel, lifecycleStage 
    });

    if (success) {
        const updatedGuest = dataManager.getGuestById(id);
        res.json({ success: true, guest: updatedGuest });
    } else {
        res.status(404).json({ success: false, message: "Guest not found" });
    }
});

app.get('/api/unknown', isAdmin, (req, res) => {
    const file = path.join(__dirname, 'data/unknownQuestions.json');

    if (!fs.existsSync(file)) return res.json([]);

    const data = JSON.parse(fs.readFileSync(file));
    res.json(data);
});

// --- BROADCAST SCHEDULING ---
const SCHEDULE_FILE = path.join(__dirname, 'data/scheduled_messages.json');

function loadScheduledMessages() {
    if (!fs.existsSync(SCHEDULE_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(SCHEDULE_FILE));
    } catch (e) {
        return [];
    }
}

function saveScheduledMessages(msgs) {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(msgs, null, 2));
}

// Re-schedule messages on server restart
const scheduledTasks = {};

function initScheduler() {
    const msgs = loadScheduledMessages();
    const now = new Date();

    msgs.forEach(msg => {
        if (msg.status === 'scheduled' && new Date(msg.scheduleTime) > now) {
            scheduleTask(msg);
        } else if (msg.status === 'scheduled') {
            msg.status = 'missed';
        }
    });
    saveScheduledMessages(msgs);
}

function scheduleTask(msgData) {
    const job = schedule.scheduleJob(new Date(msgData.scheduleTime), async function () {
        console.log(`[SCHEDULER] Triggering scheduled broadcast: ${msgData.id}`);

        // Use the same logic as host_send_broadcast
        const guests = dataManager.getGuests();
        const filters = msgData.filters || { side: 'all', status: 'all', category: 'all' };

        const targetGuests = guests.filter(g => {
            const matchSide = filters.side === 'all' || g.side === filters.side;
            const matchStatus = filters.status === 'all' ||
                (filters.status === 'vip' && g.isVIP) ||
                (filters.status === 'regular' && !g.isVIP);
            const matchCategory = filters.category === 'all' || g.category === filters.category;
            return matchSide && matchStatus && matchCategory;
        });

        if (filters.side === 'all' && filters.status === 'all' && filters.category === 'all') {
            whatsappButler.broadcastMessage(msgData.text);
        }

        const eventContext = { events: dataManager.getEvents() };

        for (const guest of targetGuests) {
            try {
                const personalizedMsg = await aiService.personalizeBroadcast(msgData.text, guest, eventContext);
                io.to(`guest_${guest.id}`).emit('receive_message', {
                    sender: 'The Wedding Butler',
                    text: personalizedMsg,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
                io.to('host_room').emit('delivery_status', {
                    guestId: guest.id,
                    status: 'sent',
                    personalizedPreview: personalizedMsg
                });
            } catch (err) {
                console.error(`[SCHEDULER-BROADCAST] Error sending to ${guest.name}:`, err.message);
            }
        }

        // Update status
        const msgs = loadScheduledMessages();
        const m = msgs.find(x => x.id === msgData.id);
        if (m) m.status = 'sent';
        saveScheduledMessages(msgs);

        io.to('host_room').emit('scheduled_message_sent', { id: msgData.id });
        delete scheduledTasks[msgData.id];
    });

    scheduledTasks[msgData.id] = job;
}

app.post('/api/schedule-broadcast', isAdmin, (req, res) => {
    const { text, scheduleTime, filters } = req.body;
    if (!text || !scheduleTime) return res.json({ success: false, message: "Text and time required" });

    const id = `sched_${Date.now()}`;
    const newMsg = { id, text, scheduleTime, filters, status: 'scheduled', createdAt: new Date().toISOString() };

    const msgs = loadScheduledMessages();
    msgs.push(newMsg);
    saveScheduledMessages(msgs);

    scheduleTask(newMsg);

    res.json({ success: true, message: "Broadcast scheduled", data: newMsg });
});

app.get('/api/scheduled-broadcasts', isAdmin, (req, res) => {
    res.json(loadScheduledMessages().filter(m => m.status === 'scheduled'));
});

app.post('/api/cancel-scheduled-broadcast', isAdmin, (req, res) => {
    const { id } = req.body;
    const msgs = loadScheduledMessages();
    const m = msgs.find(x => x.id === id);
    if (m) {
        m.status = 'cancelled';
        if (scheduledTasks[id]) {
            scheduledTasks[id].cancel();
            delete scheduledTasks[id];
        }
        saveScheduledMessages(msgs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Scheduling not found" });
    }
});

initScheduler();

// --- GUEST REGISTRATION REQUESTS ---
const REG_REQUESTS_FILE = path.join(__dirname, 'data/registration_requests.json');

function loadRegRequests() {
    if (!fs.existsSync(REG_REQUESTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(REG_REQUESTS_FILE));
    } catch (e) {
        return [];
    }
}

function saveRegRequests(reqs) {
    fs.writeFileSync(REG_REQUESTS_FILE, JSON.stringify(reqs, null, 2));
}

app.post('/api/register-request', (req, res) => {
    let { name, phone, relation, category } = req.body;
    if (!name || !phone) return res.json({ success: false, message: "Name and phone required" });

    // Normalize phone
    phone = normalizePhone(phone);

    const reqs = loadRegRequests();

    // Check if already pending or already a guest
    if (dataManager.getGuestByPhone(phone)) {
        return res.json({ success: false, message: "This phone is already registered as a guest." });
    }

    if (reqs.find(r => r.phone === phone && r.status === 'pending')) {
        return res.json({ success: false, message: "A request for this phone is already pending approval." });
    }

    const newReq = {
        id: `reg_${Date.now()}`,
        name,
        phone,
        relation: relation || 'Guest',
        category: category || 'friend',
        status: 'pending',
        timestamp: new Date().toISOString()
    };

    reqs.push(newReq);
    saveRegRequests(reqs);

    res.json({ success: true, message: "Request sent to admin! Please wait for approval." });
});

app.get('/api/admin/registration-requests', isAdmin, (req, res) => {
    res.json(loadRegRequests().filter(r => r.status === 'pending'));
});

app.post('/api/admin/approve-registration', isAdmin, async (req, res) => {
    const { id } = req.body;
    const reqs = loadRegRequests();
    const rIndex = reqs.findIndex(x => x.id === id);

    if (rIndex !== -1) {
        const r = reqs[rIndex];

        // Add to guests.json
        await dataManager.addGuest({
            id: `g_${Date.now()}`,
            name: r.name,
            phone: r.phone,
            relation: r.relation,
            category: r.category,
            language_preference: "hinglish_polite" // default
        });

        r.status = 'approved';
        saveRegRequests(reqs);

        // 🟢 A11: Notify the Guest
        const welcomeMsg = `Congratulations ${r.name}! 🎉 Your registration for the wedding has been approved. I am your Wedding Butler, here to help you throughout the events! 😊`;
        
        // 1. Socket Notify (if they have the app open)
        io.emit('registration_approved', { phone: r.phone }); 

        // 2. WhatsApp Notify
        const chatId = r.phone.replace('+', '') + "@c.us";
        whatsappButler.client.sendMessage(chatId, welcomeMsg).catch(err => {
            console.error(`[REG-NOTIFY] Failed to send WhatsApp to ${r.phone}:`, err.message);
        });

        // 3. Log to guest chat history
        const guestObj = dataManager.getGuestByPhone(r.phone);
        if (guestObj) {
            await dataManager.addChatMessage(guestObj.id, {
                sender: 'The Wedding Butler',
                text: welcomeMsg,
                type: 'outgoing',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Request not found" });
    }
});

app.post('/api/admin/deny-registration', isAdmin, (req, res) => {
    const { id } = req.body;
    const reqs = loadRegRequests();
    const rIndex = reqs.findIndex(x => x.id === id);

    if (rIndex !== -1) {
        reqs[rIndex].status = 'denied';
        saveRegRequests(reqs);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Request not found" });
    }
});

app.post('/api/admin/reconnect-whatsapp', isAdmin, async (req, res) => {
    try {
        console.log('[WHATSAPP] Manual Reconnect Triggered...');
        await whatsappButler.client.destroy().catch(() => {});
        whatsappButler.client.initialize();
        res.json({ success: true, message: "Reconnection started" });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/analytics', isAdmin, (req, res) => {
    const guests = dataManager.getGuests();
    const chats = dataManager.getChats(); // Need to ensure getChats exists in dataManager
    
    let totalMessages = 0;
    let activeChats = 0;
    let urgentCases = 0;

    Object.keys(chats).forEach(id => {
        const history = chats[id];
        if (history.length > 0) {
            activeChats++;
            totalMessages += history.length;
        }
    });

    guests.forEach(g => {
        // Simple logic for urgent cases (can be expanded)
        const mem = dataManager.getGuestMemory(g.id);
        if (mem && (mem.mood === 'angry' || mem.lastTopic === 'complaint')) {
            urgentCases++;
        }
    });

    res.json({
        totalGuests: guests.length,
        activeChats,
        urgentCases,
        totalMessages
    });
});

app.get('/api/admin/kb', isAdmin, (req, res) => {
    try {
        const kbPath = path.join(__dirname, 'data', 'knowledgeBase.json');
        if (!fs.existsSync(kbPath)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        res.json(data);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/kb/add', isAdmin, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Fact text required" });
    
    try {
        const kbPath = path.join(__dirname, 'data', 'knowledgeBase.json');
        let data = [];
        if (fs.existsSync(kbPath)) {
            data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        }
        
        data.push({
            id: `fact_${Date.now()}`,
            text: text,
            category: "general",
            tags: ["manual_entry"]
        });
        
        fs.writeFileSync(kbPath, JSON.stringify(data, null, 2));
        
        // Reload KB in AI Service
        aiService.refreshKnowledgeBase(); 
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/kb/delete', isAdmin, (req, res) => {
    const { id } = req.body;
    try {
        const kbPath = path.join(__dirname, 'data', 'knowledgeBase.json');
        if (!fs.existsSync(kbPath)) return res.json({ success: true });
        
        let data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
        data = data.filter(item => item.id !== id);
        
        fs.writeFileSync(kbPath, JSON.stringify(data, null, 2));
        aiService.refreshKnowledgeBase();
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/rsvp', async (req, res) => {
    const { guestId, attendance, foodPreference } = req.body;
    if (!guestId) return res.status(400).json({ success: false, message: "Guest ID required" });

    const success = await dataManager.updateGuest(guestId, { 
        rsvpStatus: attendance, 
        foodPreference: foodPreference || 'None',
        rsvpTimestamp: new Date().toISOString()
    });

    if (success) {
        const guest = dataManager.getGuestById(guestId);
        io.to('host_room').emit('guest_status_update', {
            guestId: guestId,
            status: 'normal',
            label: `RSVP: ${attendance === 'yes' ? '✅ attending' : '❌ no'}`
        });

        res.json({ success: true, message: "RSVP saved! Thank you! 🙏" });
    } else {
        res.status(404).json({ success: false, message: "Guest not found" });
    }
});

// --- B15: AUTOMATED EVENT BROADCASTS ---
const sentAlerts = new Set(); // To prevent duplicate alerts per process run

setInterval(async () => {
    try {
        const config = dataManager.getConfig();
        const events = dataManager.getEvents();
        const guests = dataManager.getGuests();
        const now = new Date();

        for (const event of events) {
            const eventTime = new Date(`${event.date} ${event.time}`);
            const diffMinutes = Math.round((eventTime - now) / 60000);
            
            // Alert 30 minutes before event
            const alertId = `${event.id}_30min`;
            if (diffMinutes === 30 && !sentAlerts.has(alertId)) {
                console.log(`[BROADCAST] Auto-alert for event: ${event.name}`);
                sentAlerts.add(alertId);

                const broadcastText = `✨ *Upcoming Event Alert!* ✨\n\n*${event.name}* is starting in 30 minutes at *${event.location}*! 🎊\n\nWe look forward to seeing you there! 🙏\n\n_— Your Wedding Butler_`;

                for (const g of guests) {
                    if (g.phone) {
                        const chatId = g.phone.replace('+', '') + "@c.us";
                        whatsappButler.client.sendMessage(chatId, broadcastText).catch(e => {
                            console.error(`[BROADCAST] Failed for ${g.name}:`, e.message);
                        });

                        // Save to history
                        await dataManager.addChatMessage(g.id, {
                            sender: 'The Wedding Butler',
                            text: broadcastText,
                            type: 'outgoing',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[BROADCAST] Auto-broadcast check error:', err.message);
    }
}, 60000); // Check every minute


// --- GRACEFUL SHUTDOWN ---
process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Graceful shutdown initiated...');
    try {
        schedulerService.stop();
        dataManager.flushWrites();
        await dataManager.close(); 
        await whatsappButler.client.destroy().catch(() => {});
        server.close();
        console.log('[SHUTDOWN] Cleanup complete. Goodbye!');
    } catch (e) {
        console.error('[SHUTDOWN] Error during cleanup:', e.message);
    }
    process.exit(0);
});
