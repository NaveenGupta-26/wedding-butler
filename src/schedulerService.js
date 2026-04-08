const cron = require('node-cron');
const dataManager = require('./dataManager');
const intentEngine = require('./intentEngine');
const deliveryService = require('./deliveryService');
const freeAIService = require('./freeAIService');
const personalizationLayer = require('./personalizationLayer');

class SchedulerService {
    constructor() {
        this.task = null;
        this.isRunning = false;
        this.mode = 'manual'; // manual, hybrid, auto
        this.isKilled = false; // Emergency Kill Switch
    }

    setMode(mode) {
        if (this.isKilled) {
            console.log("[SCHEDULER] 🚨 Cannot change mode: Butler is KILLED.");
            return;
        }
        this.mode = mode;
        console.log(`[SCHEDULER] Mode set to: ${mode}`);

        // Auto-start heartbeat if not in manual
        if (mode !== 'manual') {
            this.start();
        } else {
            this.stop();
        }
    }

    kill() {
        this.isKilled = true;
        this.mode = 'manual';
        this.stop();
        console.log("[SCHEDULER] 🚨 EMERGENCY KILL SWITCH ACTIVATED. Butler disabled.");
    }

    start() {
        if (this.isRunning || this.isKilled) return;

        // Every 5 minutes
        this.task = cron.schedule('*/5 * * * *', () => {
            this.checkAndSendMessages();
        });

        this.isRunning = true;
        console.log("[SCHEDULER] Heartbeat started (Every 5 mins)");
    }

    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        this.isRunning = false;
        console.log("[SCHEDULER] Heartbeat stopped");
    }

    async checkAndSendMessages() {
        if (this.mode === 'manual') return;

        console.log("[SCHEDULER] Checking for proactive opportunities...");
        const guests = dataManager.getGuests();
        const logs = deliveryService.loadLogs();

        for (const guest of guests) {
            const decision = intentEngine.getPriorityIntent(guest, logs);

            if (decision) {
                console.log(`[SCHEDULER] Triggering ${decision.intent} for ${guest.name}`);

                if (this.mode === 'auto') {
                    await this.executeProactiveMessage(guest, decision);
                } else if (this.mode === 'hybrid') {
                    // In Hybrid, we notify the Host panel that a message is suggested
                    if (deliveryService.io) {
                        deliveryService.io.to('host_room').emit('proactive_suggestion', {
                            guestId: guest.id,
                            guestName: guest.name,
                            intent: decision.intent,
                            context: decision.context
                        });
                    }
                }
            }
        }
    }

    async executeProactiveMessage(guest, decision) {
        try {
            // 1. Generate via AI
            const aiText = await freeAIService.askFreeAIProactive(decision.intent, guest, decision.context);

            if (!aiText) return;

            // 2. Enforce Personalization
            const personalizedText = personalizationLayer.enforcePersonalization(aiText, guest);

            // 3. Deliver
            const eventTimestamp = decision.eventId || 'now'; // Used for idempotency
            await deliveryService.sendProactiveMessage(guest, decision.intent, personalizedText, eventTimestamp);

        } catch (error) {
            console.error(`[SCHEDULER] Error executing proactive for ${guest.name}:`, error.message);
        }
    }
}

module.exports = new SchedulerService();
