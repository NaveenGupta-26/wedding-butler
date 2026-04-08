const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/initialData.json');
const GUESTS_PATH = path.join(__dirname, '../data/guests.json');
const CHATS_PATH = path.join(__dirname, '../data/chats.json');
const MEMORY_PATH = path.join(__dirname, '../data/guestMemory.json');

class DataManager {
    constructor() {
        this.data = this.loadInitialData();
        this.guests = this.loadGuests();
        this.chats = this.loadChats();
        this.guestMemory = this.loadGuestMemory();

        // Debounce timers for write operations
        this._chatWriteTimer = null;
        this._guestWriteTimer = null;
        this._memoryWriteTimer = null;
        this._WRITE_DELAY = 2000; // 2 second debounce
    }

    // ---------- LOADERS ----------
    loadInitialData() {
        try {
            const raw = fs.readFileSync(DATA_PATH);
            return JSON.parse(raw);
        } catch (err) {
            console.error("Error loading initialData.json:", err);
            return { config: {}, events: [] };
        }
    }

    loadGuests() {
        try {
            if (!fs.existsSync(GUESTS_PATH)) return [];
            const raw = fs.readFileSync(GUESTS_PATH);
            return JSON.parse(raw);
        } catch (err) {
            console.error("Error loading guests.json:", err);
            return [];
        }
    }

    loadChats() {
        try {
            if (!fs.existsSync(CHATS_PATH)) return {};
            const raw = fs.readFileSync(CHATS_PATH);
            return JSON.parse(raw);
        } catch (err) {
            console.error("Error loading chats.json:", err);
            return {};
        }
    }

    loadGuestMemory() {
        try {
            if (!fs.existsSync(MEMORY_PATH)) return {};
            const raw = fs.readFileSync(MEMORY_PATH);
            return JSON.parse(raw);
        } catch (err) {
            console.error("Error loading guestMemory.json:", err);
            return {};
        }
    }

    // ---------- DEBOUNCED WRITERS ----------
    saveGuests() {
        clearTimeout(this._guestWriteTimer);
        this._guestWriteTimer = setTimeout(() => {
            try {
                fs.writeFileSync(GUESTS_PATH, JSON.stringify(this.guests, null, 2));
            } catch (e) {
                console.error("[DATA] Error writing guests.json:", e.message);
            }
        }, this._WRITE_DELAY);
    }

    saveChats() {
        clearTimeout(this._chatWriteTimer);
        this._chatWriteTimer = setTimeout(() => {
            try {
                fs.writeFileSync(CHATS_PATH, JSON.stringify(this.chats, null, 2));
            } catch (e) {
                console.error("[DATA] Error writing chats.json:", e.message);
            }
        }, this._WRITE_DELAY);
    }

    saveGuestMemory() {
        clearTimeout(this._memoryWriteTimer);
        this._memoryWriteTimer = setTimeout(() => {
            try {
                fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.guestMemory, null, 2));
            } catch (e) {
                console.error("[DATA] Error writing guestMemory.json:", e.message);
            }
        }, this._WRITE_DELAY);
    }

    /**
     * Flush all pending writes immediately (for graceful shutdown).
     */
    flushWrites() {
        clearTimeout(this._chatWriteTimer);
        clearTimeout(this._guestWriteTimer);
        clearTimeout(this._memoryWriteTimer);
        try { fs.writeFileSync(GUESTS_PATH, JSON.stringify(this.guests, null, 2)); } catch (e) {}
        try { fs.writeFileSync(CHATS_PATH, JSON.stringify(this.chats, null, 2)); } catch (e) {}
        try { fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.guestMemory, null, 2)); } catch (e) {}
        console.log("[DATA] All pending writes flushed to disk.");
    }

    // ---------- CONFIG & EVENTS ----------
    getChats() {
        return this.chats || {};
    }

    getConfig() {
        return this.data.config || {};
    }

    getEvents() {
        return this.data.events || [];
    }

    /**
     * Reload config and events from disk (call when admin updates settings).
     */
    reloadData() {
        this.data = this.loadInitialData();
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

    addGuest(guest) {
        this.guests.push(guest);
        this.saveGuests();
    }

    updateGuest(id, updates) {
        const guest = this.guests.find(g => g.id === id);
        if (guest) {
            Object.assign(guest, updates);
            this.saveGuests();
            return true;
        }
        return false;
    }

    deleteGuest(id) {
        this.guests = this.guests.filter(g => g.id !== id);
        this.saveGuests();
    }

    // ---------- GUEST MEMORY ----------
    getGuestMemory(guestId) {
        if (!this.guestMemory[guestId]) {
            this.guestMemory[guestId] = {
                lastTopic: null,
                lastQuestion: null,
                repeatCount: 0,
                mood: "neutral"
            };
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

    // ---------- CHATS ----------
    getChatsByGuestId(guestId) {
        return this.chats[guestId] || [];
    }

    addChatMessage(guestId, message) {
        if (!this.chats[guestId]) this.chats[guestId] = [];
        // Ensure message has unique ID
        if (!message.id) {
            message.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        }
        // Ensure message has timestamp
        if (!message.timestamp) {
            message.timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        this.chats[guestId].push(message);
        this.saveChats(); // debounced — won't block for every single message
    }

    deleteMessages(guestId, messageIds) {
        if (!this.chats[guestId]) return;
        this.chats[guestId] = this.chats[guestId].filter(msg => !messageIds.includes(msg.id));
        this.saveChats();
    }

    clearChatsForGuest(guestId) {
        if (this.chats[guestId]) {
            delete this.chats[guestId];
            this.saveChats();
        }
    }

    clearAllChats() {
        this.chats = {};
        this.saveChats();
    }
}

module.exports = new DataManager();
