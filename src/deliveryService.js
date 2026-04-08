const fs = require('fs');
const path = require('path');
const PROACTIVE_LOG_PATH = path.join(__dirname, '../data/proactiveMessages.json');

class DeliveryService {
    constructor() {
        this.io = null;
        this.whatsapp = null;
    }

    init(io, whatsapp) {
        this.io = io;
        this.whatsapp = whatsapp;
    }

    loadLogs() {
        try {
            if (fs.existsSync(PROACTIVE_LOG_PATH)) {
                return JSON.parse(fs.readFileSync(PROACTIVE_LOG_PATH));
            }
            return [];
        } catch (e) {
            console.error("Error loading proactive logs:", e);
            return [];
        }
    }

    saveLog(log) {
        const logs = this.loadLogs();
        logs.push(log);
        fs.writeFileSync(PROACTIVE_LOG_PATH, JSON.stringify(logs, null, 2));
    }

    isDuplicate(id) {
        const logs = this.loadLogs();
        return logs.some(log => log.id === id);
    }

    async sendProactiveMessage(guest, intent, text, eventTimestamp = 'now') {
        const idempotencyKey = `${guest.id}_${intent}_${eventTimestamp}`;

        if (this.isDuplicate(idempotencyKey)) {
            console.log(`[DELIVERY] Duplicate detected for ${idempotencyKey}. Skipping.`);
            return { success: false, reason: 'duplicate' };
        }

        const logEntry = {
            id: idempotencyKey,
            guestId: guest.id,
            guestPhone: guest.phone,
            intent: intent,
            text: text,
            status: 'sent',
            timestamp: new Date().toISOString()
        };

        try {
            // 1. Send via Socket (for UI simulation)
            if (this.io) {
                const msgObj = {
                    sender: 'The Wedding Butler',
                    text: text,
                    proactive: true,
                    intent: intent,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
                this.io.to(`guest_${guest.id}`).emit('receive_message', msgObj);

                // Also notify host
                this.io.to('host_room').emit('delivery_status', {
                    guestId: guest.id,
                    status: 'sent',
                    personalizedPreview: text
                });
            }

            // 2. Send via WhatsApp
            if (this.whatsapp && this.whatsapp.client) {
                try {
                    await this.whatsapp.broadcastMessage(text, [guest.phone]);
                    logEntry.status = 'delivered';
                } catch (waError) {
                    console.error("[DELIVERY] WhatsApp send failed:", waError.message);
                    logEntry.status = 'failed';
                    logEntry.error = waError.message;
                }
            }

            this.saveLog(logEntry);
            return { success: true, status: logEntry.status };

        } catch (error) {
            console.error("[DELIVERY] Error sending message:", error);
            logEntry.status = 'failed';
            logEntry.error = error.message;
            this.saveLog(logEntry);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new DeliveryService();
