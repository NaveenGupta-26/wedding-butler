const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_PATH = path.join(__dirname, '../data/initialData.json');
const GUESTS_PATH = path.join(__dirname, '../data/guests.json');
const CHATS_PATH = path.join(__dirname, '../data/chats.json');
const MEMORY_PATH = path.join(__dirname, '../data/guestMemory.json');

class DataManager {
    constructor() {
        this.data = { config: {}, events: [] };
        this.guests = [];
        this.chats = {};
        this.guestMemory = {};
        this.db = null;
        this.isDBConnected = false;

        // Debounce timers for JSON fallback
        this._chatWriteTimer = null;
        this._guestWriteTimer = null;
        this._memoryWriteTimer = null;
        this._WRITE_DELAY = 2000;
    }

    async init() {
        console.log('[DATA] Initializing DataManager...');
        
        // 1. Initial Load from JSON (Legacy/Fallback)
        this.data = this.loadInitialData();
        this.guests = this.loadGuests();
        this.chats = this.loadChats();
        this.guestMemory = this.loadGuestMemory();

        // 2. Connect to PostgreSQL if DATABASE_URL is present
        if (process.env.DATABASE_URL) {
            try {
                this.db = new Pool({
                    connectionString: process.env.DATABASE_URL,
                    ssl: { rejectUnauthorized: false } // Required for Render
                });
                
                // Test connection
                await this.db.query('SELECT NOW()');
                console.log('[DATA] Connected to PostgreSQL ✅');
                
                await this.ensureTables();
                await this.syncWithPostgres();
                this.isDBConnected = true;
            } catch (e) {
                console.error("[DATA] PostgreSQL Connection/Sync Failed:", e.message);
                this.db = null;
            }
        }
    }

    async ensureTables() {
        console.log('[DATA] Ensuring SQL tables exist...');
        const queries = [
            `CREATE TABLE IF NOT EXISTS guests (
                id TEXT PRIMARY KEY,
                name TEXT,
                phone TEXT,
                relation TEXT,
                category TEXT,
                side TEXT,
                hotel TEXT,
                is_vip BOOLEAN DEFAULT FALSE,
                is_trial BOOLEAN DEFAULT FALSE,
                language_preference TEXT DEFAULT 'hinglish_polite',
                engagement_level TEXT,
                lifecycle_stage TEXT DEFAULT 'invited',
                rsvp_status TEXT,
                food_preference TEXT,
                rsvp_timestamp TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS chats (
                guest_id TEXT PRIMARY KEY,
                messages JSONB DEFAULT '[]'::jsonb,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                data JSONB,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS proactive_logs (
                id TEXT PRIMARY KEY,
                guest_id TEXT,
                intent TEXT,
                text TEXT,
                status TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const q of queries) {
            await this.db.query(q);
        }
    }

    async syncWithPostgres() {
        console.log('[DATA] Syncing with PostgreSQL...');

        // --- GUESTS ---
        const { rows: dbGuests } = await this.db.query('SELECT * FROM guests');
        if (dbGuests.length > 0) {
            this.guests = dbGuests.map(g => ({
                ...g,
                isVIP: g.is_vip,
                isTrial: g.is_trial,
                language_preference: g.language_preference,
                engagementLevel: g.engagement_level,
                lifecycleStage: g.lifecycle_stage,
                rsvpStatus: g.rsvp_status,
                foodPreference: g.food_preference,
                rsvpTimestamp: g.rsvp_timestamp
            }));
            console.log(`[DATA] Loaded ${this.guests.length} guests from PostgreSQL. (IDs: ${this.guests.map(g=>g.id).join(', ')})`);
        } else if (this.guests.length > 0) {
            // MIGRATION: JSON -> DB
            console.log('[DATA] Migrating guests from JSON to PostgreSQL...');
            for (const g of this.guests) {
                await this.db.query(
                    `INSERT INTO guests (id, name, phone, relation, category, side, hotel, is_vip, is_trial, lifecycle_stage)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT (id) DO NOTHING`,
                    [g.id, g.name, g.phone, g.relation, g.category, g.side, g.hotel, !!g.isVIP, !!g.isTrial, g.lifecycleStage || 'invited']
                );
            }
        }

        // --- CONFIG ---
        const { rows: dbConfig } = await this.db.query('SELECT * FROM config WHERE key = $1', ['wedding_config']);
        if (dbConfig.length > 0) {
            const payload = dbConfig[0].data;
            this.data = { config: payload.config, events: payload.events };
            console.log('[DATA] Loaded Config & Events from PostgreSQL.');
        } else if (this.data.config.groomName) {
            // MIGRATION
            console.log('[DATA] Migrating Config from JSON to PostgreSQL...');
            await this.db.query(
                `INSERT INTO config (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = $2`,
                ['wedding_config', { config: this.data.config, events: this.data.events }]
            );
        }

        // --- CHATS ---
        // Optimization: Do NOT load all chats into memory on startup.
        // They will be loaded on-demand in getChatsByGuestId.
        console.log('[DATA] Chat sync: On-demand loading enabled (Memory Optimization).');
        if (Object.keys(this.chats).length > 0 && this.db) {
            // MIGRATION: If we have local chats but none in DB, migrate them.
            const { rows: dbChatCount } = await this.db.query('SELECT count(*) FROM chats');
            if (parseInt(dbChatCount[0].count) === 0) {
                console.log('[DATA] 🛠 Migrating chats from JSON to PostgreSQL...');
                for (const guestId of Object.keys(this.chats)) {
                    await this.db.query(
                        `INSERT INTO chats (guest_id, messages) VALUES ($1, $2) ON CONFLICT (guest_id) DO UPDATE SET messages = $2`,
                        [guestId, JSON.stringify(this.chats[guestId])]
                    );
                }
                console.log(`[DATA] Successfully migrated ${Object.keys(this.chats).length} chats.`);
            }
        }
    }

    // ---------- LOADERS (JSON Fallback) ----------
    loadInitialData() {
        try {
            if (!fs.existsSync(DATA_PATH)) return { config: {}, events: [] };
            const raw = fs.readFileSync(DATA_PATH);
            return JSON.parse(raw);
        } catch (err) { return { config: {}, events: [] }; }
    }

    loadGuests() {
        try {
            if (!fs.existsSync(GUESTS_PATH)) return [];
            const raw = fs.readFileSync(GUESTS_PATH);
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch (err) { return []; }
    }

    loadChats() {
        try {
            if (!fs.existsSync(CHATS_PATH)) return {};
            const raw = fs.readFileSync(CHATS_PATH);
            return JSON.parse(raw);
        } catch (err) { return {}; }
    }

    loadGuestMemory() {
        try {
            if (!fs.existsSync(MEMORY_PATH)) return {};
            const raw = fs.readFileSync(MEMORY_PATH);
            return JSON.parse(raw);
        } catch (err) { return {}; }
    }

    // ---------- WRITERS ----------
    saveGuests() {
        clearTimeout(this._guestWriteTimer);
        this._guestWriteTimer = setTimeout(() => {
            try { fs.writeFileSync(GUESTS_PATH, JSON.stringify(this.guests, null, 2)); } catch (e) {}
        }, this._WRITE_DELAY);
    }

    saveChats() {
        clearTimeout(this._chatWriteTimer);
        this._chatWriteTimer = setTimeout(() => {
            try { fs.writeFileSync(CHATS_PATH, JSON.stringify(this.chats, null, 2)); } catch (e) {}
        }, this._WRITE_DELAY);
    }

    saveGuestMemory() {
        clearTimeout(this._memoryWriteTimer);
        this._memoryWriteTimer = setTimeout(() => {
            try { fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.guestMemory, null, 2)); } catch (e) {}
        }, this._WRITE_DELAY);
    }

    flushWrites() {
        clearTimeout(this._chatWriteTimer);
        clearTimeout(this._guestWriteTimer);
        clearTimeout(this._memoryWriteTimer);
        try { fs.writeFileSync(GUESTS_PATH, JSON.stringify(this.guests, null, 2)); } catch (e) {}
        try { fs.writeFileSync(CHATS_PATH, JSON.stringify(this.chats, null, 2)); } catch (e) {}
        try { fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.guestMemory, null, 2)); } catch (e) {}
        console.log("[DATA] All pending writes flushed to disk.");
    }

    // ---------- GUESTS ----------
    getGuests() {
        return this.guests;
    }

    getGuestById(id) {
        return this.guests.find(g => g.id === id);
    }

    getGuestByPhone(phone) {
        if (!phone) return null;
        const { phonesMatch } = require('./utils');
        return this.guests.find(g => {
            if (!g.phone) return false;
            return phonesMatch(g.phone, phone);
        });
    }

    async addGuest(guest) {
        this.guests.push(guest);
        this.saveGuests();
        console.log(`[DATA] Attempting to save new guest to SQL: ${guest.name} (${guest.id})`);
        if (this.db) {
            try {
                await this.db.query(
                    `INSERT INTO guests (id, name, phone, relation, category, side, hotel, is_vip, is_trial, lifecycle_stage, language_preference)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [guest.id, guest.name, guest.phone, guest.relation, guest.category, guest.side, guest.hotel, !!guest.isVIP, !!guest.isTrial, guest.lifecycleStage || 'invited', guest.language_preference || 'hinglish_polite']
                );
                console.log(`[DATA] SQL: Guest ${guest.id} saved successfully.`);
            } catch (e) { console.error("[SQL] Add Guest Error:", e.message); }
        } else {
            console.warn('[DATA] ⚠️ SQL Database not connected. Guest saved to local JSON only.');
        }
    }

    async updateGuest(id, updates) {
        const guest = this.guests.find(g => g.id === id);
        if (guest) {
            Object.assign(guest, updates);
            this.saveGuests();
            if (this.db) {
                try {
                    // Note: This is an abbreviated update for specific fields. 
                    // In a production app, we would build a dynamic query.
                    await this.db.query(
                        `UPDATE guests SET 
                            name = COALESCE($2, name), 
                            phone = COALESCE($3, phone),
                            relation = COALESCE($4, relation),
                            category = COALESCE($5, category),
                            lifecycle_stage = COALESCE($6, lifecycle_stage),
                            is_vip = COALESCE($7, is_vip),
                            language_preference = COALESCE($8, language_preference),
                            is_trial = COALESCE($9, is_trial),
                            rsvp_status = COALESCE($10, rsvp_status),
                            food_preference = COALESCE($11, food_preference),
                            rsvp_timestamp = COALESCE($12, rsvp_timestamp),
                            engagement_level = COALESCE($13, engagement_level),
                            side = COALESCE($14, side),
                            hotel = COALESCE($15, hotel),
                            updated_at = NOW()
                         WHERE id = $1`,
                        [id, updates.name, updates.phone, updates.relation, updates.category, updates.lifecycleStage, updates.isVIP, updates.language_preference, updates.isTrial, updates.rsvpStatus, updates.foodPreference, updates.rsvpTimestamp, updates.engagementLevel, updates.side, updates.hotel]
                    );
                } catch (e) { console.error("[SQL] Update Guest Error:", e.message); }
            }
            return true;
        }
        return false;
    }

    async deleteGuest(id) {
        this.guests = this.guests.filter(g => g.id !== id);
        this.saveGuests();
        if (this.db) {
            try {
                await this.db.query('DELETE FROM guests WHERE id = $1', [id]);
                await this.db.query('DELETE FROM chats WHERE guest_id = $1', [id]);
            } catch (e) { console.error("[SQL] Delete Guest Error:", e.message); }
        }
    }

    // ---------- CONFIG & EVENTS ----------
    getConfig() { return this.data.config || {}; }
    getEvents() { return this.data.events || []; }

    // ---------- CHATS ----------
    getChats() {
        return this.chats || {};
    }

    async getChatsByGuestId(guestId) {
        if (this.chats[guestId]) return this.chats[guestId];

        if (this.db) {
            try {
                const { rows } = await this.db.query('SELECT messages FROM chats WHERE guest_id = $1', [guestId]);
                if (rows.length > 0) {
                    this.chats[guestId] = rows[0].messages;
                    return this.chats[guestId];
                }
            } catch (e) { console.error("[SQL] Get Chat Error:", e.message); }
        }
        return this.chats[guestId] || [];
    }

    async addChatMessage(guestId, message) {
        if (!this.chats[guestId]) this.chats[guestId] = [];
        if (!message.id) message.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        if (!message.timestamp) message.timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        this.chats[guestId].push(message);
        this.saveChats();

        if (this.db) {
            try {
                await this.db.query(
                    `INSERT INTO chats (guest_id, messages) VALUES ($1, $2)
                     ON CONFLICT (guest_id) DO UPDATE SET messages = $2, updated_at = NOW()`,
                    [guestId, JSON.stringify(this.chats[guestId])]
                );
                console.log(`[DATA] SQL: Logged message for guest ${guestId}`);
            } catch (e) { console.error("[SQL] Add Chat Error:", e.message); }
        }
    }

    async clearChatsForGuest(guestId) {
        // ALWAYS clear memory if it exists
        if (this.chats[guestId]) {
            delete this.chats[guestId];
            this.saveChats();
        }
        
        // ALWAYS attempt to clear DB if connected
        if (this.db) {
            try { 
                await this.db.query('DELETE FROM chats WHERE guest_id = $1', [guestId]); 
                console.log(`[DATA] SQL: Chat history cleared for guest ${guestId}`);
            } catch (e) { 
                console.error(`[SQL] Clear Chat Error for ${guestId}:`, e.message); 
            }
        }
    }

    async clearAllChats() {
        this.chats = {};
        this.saveChats();
        if (this.db) {
            try { 
                await this.db.query('DELETE FROM chats'); 
                console.log("[DATA] SQL: All chat histories cleared.");
            } catch (e) { 
                console.error("[SQL] Clear All Chats Error:", e.message); 
            }
        }
    }

    async deleteMessages(guestId, messageIds) {
        if (!this.chats[guestId]) return;
        
        this.chats[guestId] = this.chats[guestId].filter(m => !messageIds.includes(m.id));
        this.saveChats();

        if (this.db) {
            try {
                await this.db.query(
                    `UPDATE chats SET messages = $2, updated_at = NOW() WHERE guest_id = $1`,
                    [guestId, JSON.stringify(this.chats[guestId])]
                );
                console.log(`[DATA] SQL: Deleted ${messageIds.length} messages for guest ${guestId}`);
            } catch (e) { console.error("[SQL] Delete Messages Error:", e.message); }
        }
    }

    // ---------- GUEST MEMORY ----------
    getGuestMemory(guestId) {
        if (!this.guestMemory[guestId]) {
            this.guestMemory[guestId] = { lastTopic: null, lastQuestion: null, repeatCount: 0, mood: "neutral" };
        }
        return this.guestMemory[guestId];
    }

    updateGuestMemory(guestId, updates) {
        if (!this.guestMemory[guestId]) {
            this.guestMemory[guestId] = { lastTopic: null, lastQuestion: null, repeatCount: 0, mood: "neutral" };
        }
        Object.assign(this.guestMemory[guestId], updates);
        this.saveGuestMemory();
    }

    // ---------- PROACTIVE LOGS ----------
    async saveProactiveLog(log) {
        if (this.db) {
            try {
                await this.db.query(
                    `INSERT INTO proactive_logs (id, guest_id, intent, text, status, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id) DO NOTHING`,
                    [log.id, log.guestId, log.intent, log.text, log.status, log.timestamp || new Date().toISOString()]
                );
            } catch (e) { console.error("[SQL] Save Proactive Log Error:", e.message); }
        }
    }

    async isProactiveDuplicate(id) {
        if (this.db) {
            try {
                const { rows } = await this.db.query('SELECT id FROM proactive_logs WHERE id = $1', [id]);
                return rows.length > 0;
            } catch (e) { console.error("[SQL] Check Duplicate Error:", e.message); return false; }
        }
        return false;
    }

    async loadProactiveLogs() {
        if (this.db) {
            try {
                const { rows } = await this.db.query('SELECT * FROM proactive_logs ORDER BY timestamp DESC LIMIT 100');
                return rows;
            } catch (e) { console.error("[SQL] Load Proactive Logs Error:", e.message); return []; }
        }
        return [];
    }

    async close() {
        if (this.db) {
            await this.db.end();
            console.log('[DATA] PostgreSQL connection pool closed.');
        }
    }
}

module.exports = new DataManager();
