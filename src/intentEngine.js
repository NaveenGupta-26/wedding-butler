const engagementRules = require('./engagementRules');
const fs = require('fs');
const path = require('path');
const CONTEXT_PATH = path.join(__dirname, '../data/weddingContext.json');

class IntentEngine {
    constructor() {
        this.weddingContext = this.loadWeddingContext();
    }

    loadWeddingContext() {
        try {
            if (fs.existsSync(CONTEXT_PATH)) {
                return JSON.parse(fs.readFileSync(CONTEXT_PATH));
            }
            return {};
        } catch (e) {
            console.error("Error loading wedding context:", e);
            return {};
        }
    }

    getPriorityIntent(guest, logs) {
        // Refresh context from disk for data freshness
        this.weddingContext = this.loadWeddingContext();

        const now = new Date();
        const hour = now.getHours();

        // 1. Safety Check: Quiet Hours (23:00 - 06:00)
        const quiet = this.weddingContext.quietHours || { start: 23, end: 6 };
        if (hour >= quiet.start || hour < quiet.end) {
            return null; // Don't bother the guest
        }

        // 2. Frequency Check: Limit 3 per day
        const todayLogs = logs.filter(l => {
            const date = new Date(l.timestamp);
            return date.toDateString() === now.toDateString();
        });
        if (todayLogs.length >= (this.weddingContext.engagementFrequencyLimit || 3)) {
            return null;
        }

        // 3. Logic: Lifecycle Triggers
        if (guest.lifecycleStage === 'arrived' && !this.wasSent(guest.id, 'welcome', logs)) {
            return { intent: 'welcome', priority: 1 };
        }

        if (guest.isVIP && guest.lifecycleStage === 'checked_in' && !this.wasSent(guest.id, 'comfort_check', logs)) {
            // Add timing delay: only send if guest checked in at least 2 hours ago
            // For now, let's check if there's any previous message timestamp to compare
            const arrivalLog = logs.find(l => l.guestId === guest.id && l.status === 'delivered');
            if (arrivalLog) {
                const arrivalTime = new Date(arrivalLog.timestamp);
                const hoursSinceArrival = (now - arrivalTime) / (1000 * 60 * 60);
                if (hoursSinceArrival >= 2) {
                    return { intent: 'comfort_check', priority: 2 };
                }
            } else {
                // If no logs, but checked_in, we might want to wait or use a different heuristic
                // For safety in trial, we only trigger if we have a recorded arrival/interaction
            }
        }

        // 4. Logic: Event Triggers (Event Proximity)
        const upcomingEvent = this.getUpcomingEvent(now);
        if (upcomingEvent) {
            const eventTime = new Date(upcomingEvent.time);
            const diffMin = (eventTime - now) / (1000 * 60);

            if (diffMin > 30 && diffMin <= 60 && !this.wasSent(guest.id, 'pickup_reminder', logs, upcomingEvent.id)) {
                return {
                    intent: 'pickup_reminder',
                    priority: 1,
                    context: { event: upcomingEvent.name, venue: this.weddingContext.venue, time: upcomingEvent.displayTime },
                    eventId: upcomingEvent.id
                };
            }

            if (diffMin > 0 && diffMin <= 15 && !this.wasSent(guest.id, 'event_start', logs, upcomingEvent.id)) {
                return {
                    intent: 'event_start',
                    priority: 1,
                    context: { event: upcomingEvent.name, venue: this.weddingContext.venue },
                    eventId: upcomingEvent.id
                };
            }
        }

        // 5. Logic: Engagement Strategy (Relation Based) - DISABLED FOR TRIAL
        /*
        const relation = guest.relation || 'Default';
        const strategy = engagementRules[relation] || engagementRules['Default'];

        for (const intent of strategy.intents) {
            const cooldown = strategy.cooldowns[intent] || 24;
            if (!this.wasSentRecently(guest.id, intent, logs, cooldown)) {
                return { intent: intent, priority: 3 };
            }
        }
        */

        return null; // Nothing to send
    }

    wasSent(guestId, intent, logs, eventId = null) {
        return logs.some(l => l.guestId === guestId && l.intent === intent && (!eventId || l.id.includes(eventId)));
    }

    wasSentRecently(guestId, intent, logs, cooldownHours) {
        const last = logs.filter(l => l.guestId === guestId && l.intent === intent)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
        if (!last) return false;

        const diffHours = (new Date() - new Date(last.timestamp)) / (1000 * 60 * 60);
        return diffHours < cooldownHours;
    }

    getUpcomingEvent(now) {
        const events = this.weddingContext.events || {};
        const entries = Object.entries(events)
            .map(([id, time]) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), time: new Date(time), displayTime: new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }))
            .sort((a, b) => a.time - b.time);

        return entries.find(e => e.time > now);
    }
}

module.exports = new IntentEngine();
