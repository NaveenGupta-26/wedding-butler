const socket = io();
let currentUser = null;
let selectedMessages = new Set();
let isSelectionMode = false;

// 1. Init: Check Local Storage
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('wedding_butler_guest');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showChatApp();
    }
});

// 2. Auth Flow
async function requestOtp() {
    let phone = document.getElementById('phone-input').value.trim();
    if (!phone) return alert("Enter valid phone");

    // Auto-prefix +91 if not present
    if (!phone.startsWith('+91')) {
        phone = '+91' + phone;
    }

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (data.success) {
        document.getElementById('step-phone').classList.add('hidden');
        document.getElementById('step-otp').classList.remove('hidden');

        // OTP sent successfully
        const otpInfo = document.getElementById('mock-otp-display');
        if (otpInfo) otpInfo.innerText = "Check your WhatsApp for the code.";
    } else {
        document.getElementById('login-error').innerText = data.message;
        document.getElementById('login-error').style.display = 'block';
    }
}

async function loginWithPassword() {
    let phone = document.getElementById('phone-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    const errorEl = document.getElementById('login-error');

    if (!phone) return alert("Enter valid phone");
    if (!password) return alert("Enter password");

    // Auto-prefix +91 if not present
    if (!phone.startsWith('+91')) {
        phone = '+91' + phone;
    }

    try {
        const res = await fetch('/api/login-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const data = await res.json();

        if (data.success) {
            currentUser = data.guest;
            localStorage.setItem('wedding_butler_guest', JSON.stringify(currentUser));
            showChatApp();
        } else {
            errorEl.innerText = data.message;
            errorEl.style.display = 'block';
        }
    } catch (e) {
        alert("Login failed. Check your connection.");
    }
}

async function loginAsDemo() {
    try {
        const res = await fetch('/api/login-demo');
        const data = await res.json();

        if (data.success) {
            currentUser = data.guest;
            localStorage.setItem('wedding_butler_guest', JSON.stringify(currentUser));
            showChatApp();
        } else {
            alert(data.message || "Demo login failed.");
        }
    } catch (e) {
        alert("Demo login failed. Check your connection.");
    }
}

async function verifyOtp() {
    let phone = document.getElementById('phone-input').value.trim();
    // Re-apply prefix for verification
    if (!phone.startsWith('+91')) {
        phone = '+91' + phone;
    }

    const otp = document.getElementById('otp-input').value;

    const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
    });
    const data = await res.json();

    if (data.success) {
        currentUser = data.guest;
        localStorage.setItem('wedding_butler_guest', JSON.stringify(currentUser));
        showChatApp();
    } else {
        alert("Incorrect OTP");
    }
}

// 3. UI Flow
async function showChatApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('app-container').style.display = 'flex'; // Enforce flex

    // Welcome
    const msgBox = document.getElementById('message-box');
    msgBox.innerHTML = '';

    // Load History
    try {
        const res = await fetch(`/api/my-chats/${encodeURIComponent(currentUser.phone)}`);
        const history = await res.json();
        if (history && history.length > 0) {
            history.forEach(msg => {
                // Fix alignment: if sender is 'You', it's outgoing for the guest.
                // Otherwise (Butler or Host), it's incoming.
                const type = (msg.sender === 'You') ? 'outgoing' : 'incoming';
                addMessage(msg.text, type, msg.sender, msg.timestamp, msg.id);
            });
        } else {
            addMessage(`Namaste ${currentUser.name}! 🙏 I am The Wedding Butler. Ask me anything about the wedding!`, 'incoming', 'The Wedding Butler');
        }
    } catch (e) {
        console.error("Failed to load history:", e);
        addMessage(`Namaste ${currentUser.name}! 🙏 I am The Wedding Butler. Ask me anything about the wedding!`, 'incoming', 'The Wedding Butler');
    }

    // Socket
    socket.emit('join', { role: 'guest', id: currentUser.id });
    
    // B2: Init Dashboard
    updateDashboardCard();

    socket.on('receive_message', (data) => {
        hideTyping();
        addMessage(data.text, 'incoming', data.sender, data.timestamp, data.id);
    });

    socket.on('butler_typing', (data) => {
        if (data.typing) showTyping();
        else hideTyping();
    });

    // Listen for WhatsApp connection status
    socket.on('whatsapp_status', (data) => {
        const statusEl = document.querySelector('.chat-title span:last-child');
        if (statusEl) {
            statusEl.innerText = data.status === 'Connected' ? 'online' : 'offline';
            statusEl.style.color = data.status === 'Connected' ? '#8696a0' : '#ff4757';
        }
    });
}

async function updateDashboardCard() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const events = config.events || [];
        const now = new Date();

        // Sort events by date/time
        const sortedEvents = events.sort((a, b) => new Date(`${a.date} ${a.time}`) - new Date(`${b.date} ${b.time}`));
        
        let currentEvent = null;
        let nextEvent = null;

        for (let i = 0; i < sortedEvents.length; i++) {
            const eventTime = new Date(`${sortedEvents[i].date} ${sortedEvents[i].time}`);
            if (eventTime <= now) {
                currentEvent = sortedEvents[i];
            } else {
                nextEvent = sortedEvents[i];
                break;
            }
        }

        const dash = document.getElementById('dashboard-container');
        if (!dash) return;

        if (!currentEvent && !nextEvent) {
            dash.innerHTML = '';
            return;
        }

        dash.innerHTML = `
            <div class="dashboard-card" id="dash-card">
                <div class="dash-header">
                    <div class="dash-title">Today's Schedule</div>
                    <div class="dash-dot"></div>
                </div>
                <div class="dash-event-info">
                    <div class="dash-now">
                        ${currentEvent ? `Happening Now: <b>${currentEvent.name}</b>` : 'Welcome to the Wedding! 🎉'}
                    </div>
                    ${nextEvent ? `
                    <div class="dash-next">
                        <ion-icon name="time-outline"></ion-icon>
                        Next: ${nextEvent.name} at ${nextEvent.time}
                    </div>` : ''}
                </div>
            </div>
        `;

        // Handle collapse on scroll
        const msgBox = document.getElementById('message-box');
        msgBox.addEventListener('scroll', () => {
            const card = document.getElementById('dash-card');
            if (msgBox.scrollTop > 50) {
                card.classList.add('collapsed');
            } else {
                card.classList.remove('collapsed');
            }
        });

    } catch (e) {
        console.error("Dashboard update failed:", e);
    }
}

function openRSVPModal() { document.getElementById('rsvp-modal').classList.remove('hidden'); }
function closeRSVPModal() { document.getElementById('rsvp-modal').classList.add('hidden'); }

async function submitRSVP() {
    const attendance = document.getElementById('rsvp-attendance').value;
    const food = document.getElementById('rsvp-food').value;

    try {
        const res = await fetch('/api/rsvp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guestId: currentUser.id,
                attendance: attendance,
                foodPreference: food
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            closeRSVPModal();
            const btn = document.getElementById('rsvp-btn');
            if (btn) btn.style.display = 'none';
        }
    } catch (e) {
        console.error("RSVP failed:", e);
        alert("Failed to save RSVP. Please try again.");
    }
}

function logout() {
    localStorage.removeItem('wedding_butler_guest');
    location.reload();
}

// --- Menu & Management ---
function toggleMenu() {
    const menu = document.getElementById('dropdown-menu');
    menu.classList.toggle('hidden');
}

// Close menu on click outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('dropdown-menu');
    const menuBtn = document.querySelector('.menu-btn');
    if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    }
});

async function clearChat(event) {
    if (event) event.preventDefault();
    if (!confirm("Are you sure you want to clear your chat history? This cannot be undone.")) return;

    try {
        const res = await fetch('/api/my-chats/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentUser.phone })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('message-box').innerHTML = '';
            document.getElementById('dropdown-menu').classList.add('hidden');
            addMessage(`Namaste ${currentUser.name}! 🙏 I am The Wedding Butler. Ask me anything about the wedding!`, 'incoming', 'The Wedding Butler');
        }
    } catch (e) {
        console.error("Clear chat error:", e);
    }
}

// --- Multi-Select Logic ---
function toggleMessageSelection(msgId, element) {
    if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
        element.classList.remove('selected');
    } else {
        selectedMessages.add(msgId);
        element.classList.add('selected');
    }

    if (selectedMessages.size === 0) {
        exitSelectionMode();
    } else {
        updateSelectionHeader();
    }
}

function enterSelectionMode(msgId, element) {
    isSelectionMode = true;
    document.getElementById('selection-header').classList.remove('hidden');
    document.querySelector('.main-chat').classList.add('selection-mode-active');
    toggleMessageSelection(msgId, element);
}

function exitSelectionMode() {
    isSelectionMode = false;
    selectedMessages.clear();
    document.getElementById('selection-header').classList.add('hidden');
    document.querySelector('.main-chat').classList.remove('selection-mode-active');
    document.querySelectorAll('.message.selected').forEach(el => el.classList.remove('selected'));
}

function updateSelectionHeader() {
    document.getElementById('selection-count').innerText = `${selectedMessages.size} selected`;
}

async function deleteSelectedMessages() {
    if (!confirm(`Delete ${selectedMessages.size} selected messages?`)) return;

    try {
        const res = await fetch('/api/my-chats/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: currentUser.phone,
                messageIds: Array.from(selectedMessages)
            })
        });
        const data = await res.json();
        if (data.success) {
            document.querySelectorAll('.message.selected').forEach(el => el.remove());
            exitSelectionMode();
        }
    } catch (e) {
        console.error("Delete messages error:", e);
    }
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'outgoing', 'You');
    socket.emit('guest_send_message', { guestId: currentUser.id, message: text });
    input.value = '';
}

function handleEnter(e) {
    if (e.key === 'Enter') sendMessage();
}

function requestEmergencyContact() {
    if (!currentUser) return;

    // Fetch SOS number first
    fetch('/api/wedding-context')
        .then(res => res.json())
        .then(context => {
            const sosPhone = context.emergencyContact ? context.emergencyContact.phone : "Unknown";
            const sosName = context.emergencyContact ? context.emergencyContact.name : "Host";

            if (!confirm(`🚨 EMERGENCY SOS 🚨\n\nYou are about to alert the Host immediately.\n\nHost: ${sosName}\nPhone: ${sosPhone}\n\nDo you want to proceed and send the alert?`)) return;

            addSystemMessage("Sending SOS alert to Host...");
            socket.emit('guest_emergency_contact', {
                guestId: currentUser.id,
                guestName: currentUser.name,
                phone: currentUser.phone
            });

            // Additionally, offer a direct call link
            addSystemMessage(`Direct Call Host: <a href="tel:${sosPhone}" style="color: #ff4757; font-weight: bold;">${sosPhone}</a>`);

            // Visual feedback
            const sosBtn = document.querySelector('.sos-btn');
            if (sosBtn) {
                sosBtn.innerText = "SENT";
                sosBtn.style.background = "#2ed573";
                sosBtn.style.animation = "none";
                setTimeout(() => {
                    sosBtn.innerText = "SOS";
                    sosBtn.style.background = "#ff4757";
                    sosBtn.style.animation = "pulse-red 2s infinite";
                }, 5000);
            }
        });
}

function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// UI Helpers
function addMessage(text, type, sender, time = 'Now', msgId = null) {
    if (!text) text = " "; // Default to empty space if null
    const box = document.getElementById('message-box');
    const div = document.createElement('div');
    div.className = `message msg-${type}`;

    // Assign unique ID if provided or generate temporary one if none exists (though server should provide)
    const id = msgId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    div.setAttribute('data-id', id);

    const processedText = text
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#34b7f1; text-decoration:underline;">$1</a>')
        .replace(/\n/g, '<br>');

    // Don't show sender name for "You" in Guest App
    const senderHtml = (sender && sender !== 'You') ? `<div class="msg-sender">${sanitizeHTML(sender)}</div>` : '';

    div.innerHTML = `
        ${senderHtml}
        <div class="msg-content">${processedText}</div>
        <span class="msg-time">${sanitizeHTML(time)}</span>
    `;

    // Click behavior for selection
    div.addEventListener('click', (e) => {
        if (isSelectionMode) {
            toggleMessageSelection(id, div);
        }
    });

    // Long press for entering selection mode
    let pressTimer;
    div.addEventListener('mousedown', () => {
        if (!isSelectionMode) {
            pressTimer = window.setTimeout(() => enterSelectionMode(id, div), 600);
        }
    });
    div.addEventListener('mouseup', () => clearTimeout(pressTimer));
    div.addEventListener('touchstart', () => {
        if (!isSelectionMode) {
            pressTimer = window.setTimeout(() => enterSelectionMode(id, div), 600);
        }
    });
    div.addEventListener('touchend', () => clearTimeout(pressTimer));

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    // 🟢 B1: Render Quick Replies only for specific triggers
    if (type === 'incoming' && sender === 'The Wedding Butler') {
        const lowerTxt = text.toLowerCase();
        const helpKeywords = ["help", "madad", "assist", "kya karu", "kaise", "what can you do"];
        const isHelpRequest = helpKeywords.some(k => lowerTxt.includes(k));
        
        // Also check if it's the first message (Namaste...)
        const isFirstMsg = lowerTxt.includes("namaste") && lowerTxt.includes("butler");

        if (isHelpRequest || isFirstMsg) {
            renderQuickReplies();
        } else {
            const oldReplies = document.querySelector('.quick-replies-container');
            if (oldReplies) oldReplies.remove();
        }
    } else {
        // Remove old quick replies container if user is typing a new message
        const oldReplies = document.querySelector('.quick-replies-container');
        if (oldReplies) oldReplies.remove();
    }
}

function renderQuickReplies() {
    const box = document.getElementById('message-box');
    
    // Remove existing container if any
    const existing = document.querySelector('.quick-replies-container');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'quick-replies-container';

    const buttons = [
        { label: '📅 Schedule', value: 'schedule' },
        { label: '🍛 Food Menu', value: 'food menu' },
        { label: '📍 Venue', value: 'venue location' },
        { label: '🛎 Help', value: 'help' }
    ];

    buttons.forEach(btn => {
        const b = document.createElement('button');
        b.className = 'quick-reply-btn';
        b.innerText = btn.label;
        b.onclick = () => {
            document.getElementById('msg-input').value = btn.value;
            sendMessage();
            container.remove(); // Remove after use
        };
        container.appendChild(b);
    });

    box.appendChild(container);
    box.scrollTop = box.scrollHeight;
}



function addSystemMessage(text) {
    const box = document.getElementById('message-box');
    const div = document.createElement('div');
    div.className = `message msg-system`;
    div.innerHTML = text; // Allow HTML for SOS links
    box.appendChild(div);
}

function showTyping() {
    const box = document.getElementById('message-box');
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    }
    box.appendChild(indicator);
    box.scrollTop = box.scrollHeight;
}

function hideTyping() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

// --- Guest Registration ---
window.openRegistration = function () {
    document.getElementById('registration-modal').classList.remove('hidden');
    document.getElementById('registration-modal').style.display = 'flex';
}

window.closeRegistration = function () {
    document.getElementById('registration-modal').classList.add('hidden');
    document.getElementById('registration-modal').style.display = 'none';
}

window.submitRegistration = async function () {
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const relation = document.getElementById('reg-relation').value.trim();
    const category = document.getElementById('reg-category').value;

    if (!name || !phone) return alert("Name and Phone are required.");

    const res = await fetch('/api/register-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, relation, category })
    });
    const data = await res.json();

    if (data.success) {
        alert(data.message);
        closeRegistration();
    } else {
        alert(data.message);
    }
}
