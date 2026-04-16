const socket = io();
let activeGuestId = null;
let guestLogs = {}; // Local storage of chat history per guest
let allGuests = []; // Global guest list


document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is authenticated as admin
    const authCheck = await fetch('/api/admin-check');
    const authData = await authCheck.json();
    if (!authData.isAdmin) {
        window.location.href = '/admin-login.html';
        return;
    }

    // 1. Join as Host
    socket.emit('join', { role: 'host' });

    // 2. Load Guest List
    const res = await fetch('/api/guests');
    allGuests = await res.json();
    const guests = allGuests;
    const list = document.getElementById('guest-list');
    list.innerHTML = `<div style="padding: 15px; border-bottom: 2px solid var(--royal-ivory); font-weight: 700; color: var(--royal-gold-dark);">Guest List (${guests.length})</div>`;

    guests.forEach(g => {
        const div = document.createElement('div');
        div.className = 'guest-item';
        div.id = `guest-entry-${g.id}`;

        div.dataset.id = g.id;

        div.onclick = () => selectGuest(g.id, g.name);
        div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin:0;">${sanitizeHTML(g.name)} ${g.isVIP ? '⭐' : ''} ${g.isTrial ? '<span style="color: #25d366; font-size: 10px;">(Trial)</span>' : ''}</h4>
            <span style="font-size: 10px; background: var(--royal-gold-muted); color: var(--royal-gold-dark); padding: 2px 5px; border-radius: 4px;">${sanitizeHTML(g.side || 'Groom')}</span>
        </div>
        <span style="font-size: 11px; color: var(--text-muted);">${sanitizeHTML(g.phone)} | ${sanitizeHTML(g.relation || 'Guest')}</span>
    `;
        list.appendChild(div);
        guestLogs[g.id] = [];
    });

    // Load Scheduled Broadcasts
    loadScheduledBroadcasts();

    // Initialize Flatpickr for premium Date & Time picking
    flatpickr("#schedule-time", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        minDate: "today",
        theme: "material_orange" // matching with gold
    });

    // 4. Registration Requests
    loadRegistrationRequests();

    // 5. System Settings
    loadSystemSettings();

    // 6. Analytics (B5/B6)
    refreshAnalytics();

    // 7. Knowledge Base (B13)
    loadKB();

    // 8. Guest Search
    document.getElementById('guest-search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.guest-item').forEach(el => {
            const name = el.querySelector('h4').textContent.toLowerCase();
            const phone = el.querySelector('span').textContent.toLowerCase();
            if (name.includes(term) || phone.includes(term)) {
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        });
    });
});

function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Chat Selection ---
async function selectGuest(id, name) {
    activeGuestId = id;
    document.getElementById('active-guest-name').innerText = `Chatting with: ${name}`;
    document.getElementById('clear-chat-btn').style.display = 'block';

    // Highlight UI
    document.querySelectorAll('.guest-item').forEach(d => d.classList.remove('active'));
    document.getElementById(`guest-entry-${id}`).classList.add('active');

    // Remove "Needs Help" badge or unread badge
    const badge = document.querySelector(`#guest-entry-${id} .guest-badge`);
    if (badge) badge.style.display = 'none';

    const unread = document.querySelector(`#guest-entry-${id} .unread-badge`);
    if (unread) unread.remove();

    // Fetch and Render History from Server
    try {
        const res = await fetch(`/api/chats/${id}`);
        const history = await res.json();
        guestLogs[id] = history || []; // Update local cache
    } catch (e) {
        console.error("Failed to load guest history:", e);
    }

    renderChat(id);
}

function renderChat(id) {
    const box = document.getElementById('admin-chat-box');
    box.innerHTML = '';
    const logs = guestLogs[id] || [];
    logs.forEach(log => {
        addBubble(log.text, log.type, log.sender, log.time);
    });
}

// --- Socket Listeners ---
socket.on('guest_activity', (data) => {
    // 1. Store Log
    logMessage(data.guestId, data.message, 'incoming', data.guestName, data.timestamp);

    // 2. Play notification sound
    const audio = document.getElementById('notif-sound');
    if (audio) audio.play().catch(e => console.log("Sound play failed:", e));

    // 3. Refresh View if viewing this guest
    if (activeGuestId === data.guestId) {
        addBubble(data.message, 'incoming', data.guestName, data.timestamp);
    } else {
        // Show unread indicator
        const entry = document.getElementById(`guest-entry-${data.guestId}`);
        if (entry) {
            let unread = entry.querySelector('.unread-badge');
            if (!unread) {
                unread = document.createElement('span');
                unread.className = 'unread-badge';
                unread.style.cssText = 'background: #25d366; color: white; border-radius: 50%; padding: 2px 6px; font-size: 10px; margin-left: 5px; font-weight: bold;';
                unread.textContent = '1';
                entry.querySelector('h4').appendChild(unread);
            } else {
                unread.textContent = parseInt(unread.textContent) + 1;
            }
        }
    }
});

socket.on('ai_log', (data) => {
    hideButlerTyping();
    logMessage(data.guestId, data.response, 'outgoing', 'Wedding Butler (AI)');
    if (activeGuestId === data.guestId) {
        addBubble(data.response, 'outgoing', 'Wedding Butler (AI)');
    }
});

socket.on('butler_typing', (data) => {
    const { guestId, typing } = data;
    if (activeGuestId === guestId) {
        if (typing) showButlerTyping();
        else hideButlerTyping();
    }
});

socket.on('emergency_alert', (data) => {
    console.log("[SOS] Received Emergency Alert:", data);

    // 1. Browser Notification
    alert(`🚨 EMERGENCY ALERT 🚨\n\nGuest: ${data.guestName}\nPhone: ${data.phone}\nTime: ${data.timestamp}\n\nPlease check the chat immediately!`);

    // 2. Highlight the guest in the list
    const entry = document.getElementById(`guest-entry-${data.guestId}`);
    if (entry) {
        entry.style.background = "rgba(255, 71, 87, 0.2)";
        entry.style.borderLeft = "5px solid #ff4757";
    }
});

socket.on('guest_status_update', (data) => {
    const { guestId, status, label } = data;
    const guestEntry = document.getElementById(`guest-entry-${guestId}`);

    if (guestEntry) {
        let badge = guestEntry.querySelector('.guest-badge');

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'guest-badge';
            guestEntry.appendChild(badge);
        }

        // Show Badge
        badge.style.display = 'inline-block';
        badge.textContent = label || 'Alert';
        badge.className = 'guest-badge ' + (status || '');

        // Set Color/Type via Class instead of inline styles for better control
        if (status === 'serious') {
            badge.classList.add('badge-serious');
        } else if (status === 'admin_help') {
            badge.classList.add('badge-help');
        } else if (status === 'normal') {
            badge.classList.add('badge-normal');
        }
    }
});

socket.on('delivery_status', (data) => {
    // Log broadcast sent by system
    logMessage(data.guestId, data.personalizedPreview, 'outgoing', 'Wedding Butler (Broadcast)');
    if (activeGuestId === data.guestId) {
        addBubble(data.personalizedPreview, 'outgoing', 'Wedding Butler (Broadcast)');
    }
});

socket.on('scheduled_message_sent', (data) => {
    console.log("[ADMIN] Scheduled broadcast sent:", data.id);
    loadScheduledBroadcasts(); // Refresh list to remove the sent one
});

socket.on('whatsapp_qr', (data) => {
    const qrImg = document.getElementById('qr-img');
    const qrContainer = document.getElementById('qr-container');
    if (qrImg) {
        qrImg.src = data.qr;
        qrImg.style.display = 'block';
        qrContainer.querySelector('p').style.display = 'none';
        document.getElementById('whatsapp-status').innerText = 'Status: Scan QR to Connect';
    }
});

socket.on('whatsapp_status', (data) => {
    const el = document.getElementById('whatsapp-status');
    const qrContainer = document.getElementById('qr-container'); // Retain qrContainer logic
    if (el) {
        el.innerText = `Status: ${data.status}`;
        if (data.status === 'Connected') {
            qrContainer.style.display = 'none';
        } else {
            qrContainer.style.display = 'block';
        }
    }
});

// --- Host Actions ---

// 1. Direct Reply
function sendAdminReply() {
    if (!activeGuestId) return alert("Select a guest first.");
    const input = document.getElementById('admin-msg-input');
    const text = input.value.trim();
    if (!text) return;

    // Emit
    socket.emit('host_direct_reply', { guestId: activeGuestId, text });

    // Log
    logMessage(activeGuestId, text, 'outgoing', 'You (Host)');
    addBubble(text, 'outgoing', 'You (Host)');
    input.value = '';
}

function handleAdminEnter(e) { if (e.key === 'Enter') sendAdminReply(); }

// 2. Broadcast
function sendBroadcast() {
    const text = document.getElementById('broadcast-input').value.trim();
    if (!text) return;

    const filters = {
        side: document.getElementById('broadcast-side').value,
        status: document.getElementById('broadcast-status').value,
        category: document.getElementById('broadcast-category').value
    };

    let confirmMsg = "Send this broadcast?";
    if (filters.side !== 'all' || filters.status !== 'all' || filters.category !== 'all') {
        confirmMsg = `Send this segmented broadcast to specific guests?`;
    } else {
        confirmMsg = "Send this broadcast to ALL guests?";
    }

    if (confirm(confirmMsg)) {
        socket.emit('host_send_broadcast', { message: text, filters });
        document.getElementById('broadcast-input').value = '';
        alert("Broadcast queued!");
    }
}

// 2b. Schedule Broadcast
async function scheduleBroadcast() {
    const text = document.getElementById('broadcast-input').value.trim();
    const time = document.getElementById('schedule-time').value;

    if (!text || !time) return alert("Please enter a message and select a time.");

    const schedDate = new Date(time);
    if (schedDate <= new Date()) return alert("Schedule time must be in the future!");

    const filters = {
        side: document.getElementById('broadcast-side').value,
        status: document.getElementById('broadcast-status').value,
        category: document.getElementById('broadcast-category').value
    };

    const res = await fetch('/api/schedule-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, scheduleTime: time, filters })
    });

    const data = await res.json();
    if (data.success) {
        alert("Broadcast scheduled successfully!");
        document.getElementById('broadcast-input').value = '';
        document.getElementById('schedule-time').value = '';
        loadScheduledBroadcasts();
    } else {
        alert("Failed to schedule: " + data.message);
    }
}

async function loadScheduledBroadcasts() {
    const res = await fetch('/api/scheduled-broadcasts');
    const data = await res.json();
    const container = document.getElementById('scheduled-list-container');
    const list = document.getElementById('scheduled-messages-list');

    if (data.length > 0) {
        container.style.display = 'block';
        list.innerHTML = data.map(m => `
            <div style="background: var(--card-bg); border: 1px solid var(--royal-gold-muted); padding: 15px; border-radius: 10px; margin-bottom: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                <p style="font-size: 12px; color: var(--royal-gold-dark); font-weight: 700; display: flex; align-items: center; gap: 5px;">
                    <ion-icon name="time-outline"></ion-icon> ${new Date(m.scheduleTime).toLocaleString()}
                </p>
                <p style="font-size: 13px; color: var(--text-dark); margin: 8px 0; line-height: 1.4;">
                    ${m.text}
                </p>
                <button onclick="cancelBroadcast('${m.id}')" style="background: transparent; border: 1px solid #ff6b6b; color: #ff6b6b; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.2s;">Cancel Broadcast</button>
            </div>
        `).join('');
    } else {
        container.style.display = 'none';
        list.innerHTML = '';
    }
}

window.cancelBroadcast = async function (id) {
    if (!confirm("Are you sure you want to cancel this scheduled broadcast?")) return;

    const res = await fetch('/api/cancel-scheduled-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });

    if (res.ok) {
        loadScheduledBroadcasts();
    } else {
        alert("Failed to cancel broadcast.");
    }
}

// 3. Train AI
async function trainAI() {
    const q = document.getElementById('train-q').value.trim();
    const a = document.getElementById('train-a').value.trim();
    if (!q || !a) return alert("Please fill both question and answer.");

    const res = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, answer: a })
    });
    const data = await res.json();
    if (data.success) {
        alert("Knowledge added!");
        document.getElementById('train-q').value = '';
        document.getElementById('train-a').value = '';
    }
}

// 4. Add Guest
async function addNewGuest() {
    const name = document.getElementById('new-guest-name').value;
    const phone = document.getElementById('new-guest-phone').value;
    const relation = document.getElementById('new-guest-relation').value;
    const side = document.getElementById('new-guest-side').value;
    const hotel = document.getElementById('new-guest-hotel').value;
    const isVIP = document.getElementById('new-guest-vip').checked;

    if (!name || !phone) return alert("Name and Phone are needed.");

    const res = await fetch('/api/add-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, relation, side, hotel, isVIP })
    });
    const data = await res.json();
    if (data.success) {
        alert("Guest Added!");
        location.reload(); // Refresh list
    }
}

// --- Helpers ---
function logMessage(id, text, type, sender, time = 'Now') {
    if (!guestLogs[id]) guestLogs[id] = [];
    guestLogs[id].push({ text, type, sender, time });
}

function displayMessage(msg, prepend = false) {
    const box = document.getElementById('admin-chat-box');
    const div = document.createElement('div');
    div.className = `message admin-msg-${msg.type || 'incoming'}`;
    
    let text = sanitizeHTML(msg.text);
    // B4: Render Media (Image Detection)
    if (text.includes('[Sent a Photo:')) {
        const match = text.match(/\[Sent a Photo: (.*?)\]/);
        if (match && match[1]) {
            const url = match[1];
            const caption = text.split(']')[1] || '';
            text = `<img src="${url}" style="max-width:200px; border-radius:10px; display:block; margin-bottom:5px; cursor:pointer;" onclick="window.open('${url}')"><br>${caption}`;
        }
    } else {
        text = text.replace(/\n/g, '<br>');
    }

    div.innerHTML = `
        <div class="msg-content">${text}</div>
        <div class="msg-time">${msg.timestamp}</div>
    `;
    
    if (prepend) box.prepend(div);
    else box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function addBubble(text, type, sender, time = 'Now') {
    const box = document.getElementById('admin-chat-box');
    const div = document.createElement('div');

    // type is 'incoming' (Guest) or 'outgoing' (Butler/Host)
    div.className = `message msg-${type}`;

    // Process text for links and newlines
    const processedText = text
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#34b7f1; text-decoration:underline;">$1</a>')
        .replace(/\n/g, '<br>');

    const senderHtml = sender ? `<div class="msg-sender">${sanitizeHTML(sender)}</div>` : '';

    div.innerHTML = `
        ${senderHtml}
        <div class="msg-content">${processedText}</div>
        <span class="msg-time">${sanitizeHTML(time)}</span>
    `;

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function showButlerTyping() {
    const box = document.getElementById('admin-chat-box');
    let indicator = document.getElementById('butler-typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'butler-typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    }
    box.appendChild(indicator); // Always move to bottom
    box.scrollTop = box.scrollHeight;
}

function hideButlerTyping() {
    const indicator = document.getElementById('butler-typing-indicator');
    if (indicator) indicator.remove();
}

let selectedGuestId = null;

// Right click on guest
document.addEventListener('contextmenu', function (e) {
    const guestItem = e.target.closest('.guest-item');
    if (!guestItem) return;

    e.preventDefault();

    selectedGuestId = guestItem.dataset.id;

    const menu = document.getElementById('guestContextMenu');
    menu.style.background = 'var(--card-bg)';
    menu.style.color = 'var(--text-dark)';
    menu.style.border = '1px solid var(--royal-gold-muted)';
    menu.style.top = e.pageY + 'px';
    menu.style.left = e.pageX + 'px';
    menu.style.display = 'block';
});

// Hide menu on normal click
document.addEventListener('click', () => {
    document.getElementById('guestContextMenu').style.display = 'none';
});

document.getElementById('ctx-delete').addEventListener('click', async () => {
    if (!selectedGuestId) return;

    const ok = confirm('Are you sure you want to delete this guest?');
    if (!ok) return;

    await fetch('/api/delete-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedGuestId })
    });

    alert('Guest deleted successfully');
    location.reload();
});



let updateGuestId = null;

// OPEN UPDATE MODAL
document.getElementById('ctx-edit').addEventListener('click', () => {
    if (!selectedGuestId) return;

    updateGuestId = selectedGuestId;

    // Find full guest object from global array
    const guestObj = allGuests.find(g => g.id === updateGuestId);

    if (guestObj) {
        document.getElementById('upd-name').value = guestObj.name || '';
        document.getElementById('upd-phone').value = guestObj.phone || '';
        document.getElementById('upd-relation').value = guestObj.relation || '';
        document.getElementById('upd-category').value = guestObj.category || '';
        document.getElementById('upd-side').value = guestObj.side || 'Groom';
        document.getElementById('upd-hotel').value = guestObj.hotel || '';
        document.getElementById('upd-vip').checked = !!guestObj.isVIP;
    } else {
        // Fallback (should typically not happen if sync is good)
        document.getElementById('upd-name').value = '';
        document.getElementById('upd-phone').value = '';
    }

    document.getElementById('updateGuestModal').style.display = 'block';

    // Minimal modal styling update
    const modalContent = document.querySelector('#updateGuestModal > div');
    if (modalContent) {
        modalContent.style.background = 'var(--card-bg)';
        modalContent.style.color = 'var(--text-dark)';
        modalContent.style.border = '1px solid var(--royal-gold)';
    }
});

// CLOSE MODAL
window.closeUpdateModal = function () {
    document.getElementById('updateGuestModal').style.display = 'none';
    updateGuestId = null;
}

// SAVE UPDATE
window.saveGuestUpdate = async function () {

    if (!updateGuestId) return;

    const payload = {
        id: updateGuestId,
        name: document.getElementById('upd-name').value.trim(),
        phone: document.getElementById('upd-phone').value.trim(),
        relation: document.getElementById('upd-relation').value.trim(),
        category: document.getElementById('upd-category').value.trim(),
        side: document.getElementById('upd-side').value,
        hotel: document.getElementById('upd-hotel').value.trim(),
        isVIP: document.getElementById('upd-vip').checked
    };

    const res = await fetch('/api/update-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
        alert('Guest updated successfully');
        location.reload();
    } else {
        alert(data.message || 'Update failed');
    }
}

window.handleLogout = async function () {
    await fetch('/api/admin-logout', { method: 'POST' });
    window.location.href = '/admin-login.html';
}

// --- Guest Registration Management ---
async function loadRegistrationRequests() {
    const res = await fetch('/api/admin/registration-requests');
    const data = await res.json();
    const container = document.getElementById('registration-requests-card');
    const list = document.getElementById('registration-requests-list');

    if (data && data.length > 0) {
        container.style.display = 'block';
        list.innerHTML = data.map(req => `
            <div style="background: var(--card-bg); border: 1px solid var(--royal-gold-muted); padding: 15px; border-radius: 10px; margin-bottom: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div>
                        <h4 style="font-family: 'Playfair Display', serif; color: var(--royal-gold-dark); margin:0;">${sanitizeHTML(req.name)}</h4>
                        <p style="font-size: 11px; color: var(--text-muted); margin:0;">${sanitizeHTML(req.phone)}</p>
                    </div>
                    <span style="font-size: 10px; background: var(--royal-gold-muted); color: var(--royal-gold-dark); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--royal-gold-muted);">${sanitizeHTML(req.category)}</span>
                </div>
                <p style="font-size: 12px; color: var(--text-dark); margin-bottom: 12px;">Relation: <b>${sanitizeHTML(req.relation)}</b></p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn" onclick="approveRegistration('${req.id}')" style="flex: 1; padding: 8px; font-size: 12px; background: #0bc14a; box-shadow: none; border: none;">Approve</button>
                    <button class="btn" onclick="denyRegistration('${req.id}')" style="flex: 1; padding: 8px; font-size: 12px; background: #8f2c2c; box-shadow: none;">Deny</button>
                </div>
            </div>
        `).join('');
    } else {
        container.style.display = 'none';
        list.innerHTML = '';
    }
}

window.approveRegistration = async function (id) {
    if (!confirm("Approve this guest and add them to the list?")) return;
    const res = await fetch('/api/admin/approve-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    if (res.ok) {
        alert("Guest approved and added!");
        loadRegistrationRequests();
        location.reload(); // Refresh to see new guest in list
    }
}

window.denyRegistration = async function (id) {
    if (!confirm("Deny this registration request?")) return;
    const res = await fetch('/api/admin/deny-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    if (res.ok) {
        loadRegistrationRequests();
    }
}

// --- History Management ---
async function clearCurrentChat() {
    if (!activeGuestId) return;
    if (!confirm("Are you sure you want to clear this guest's chat history?")) return;

    try {
        const res = await fetch(`/api/chats/clear/${activeGuestId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            guestLogs[activeGuestId] = [];
            renderChat(activeGuestId);
        }
    } catch (e) {
        alert("Delete failed");
    }
}

async function clearAllChats() {
    if (!confirm("CRITICAL: This will delete ALL chat histories for EVERY guest. Proceed?")) return;

    try {
        const res = await fetch(`/api/chats/clear-all`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            guestLogs = {};
            if (activeGuestId) {
                renderChat(activeGuestId);
            }
            alert("All chats cleared.");
        }
    } catch (e) {
        alert("Global clear failed");
    }
}
// --- Proactive Butler Functions ---
window.setButlerMode = async function (mode) {
    const res = await fetch('/api/admin/proactive-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (data.success) {
        // Toggle UI buttons
        ['manual', 'hybrid', 'auto'].forEach(m => {
            const btn = document.getElementById(`mode-${m}`);
            if (btn) btn.classList.toggle('active', m === mode);
        });
    }
}

window.triggerProactive = async function (intent, guestId = activeGuestId, context = {}) {
    if (!guestId) {
        alert("Please select a guest first or use a suggestion.");
        return;
    }

    const res = await fetch('/api/admin/send-proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId, intent, context })
    });
    const data = await res.json();
    if (data.success) {
        console.log(`[PROACTIVE] ${intent} sent to guest ${guestId}`);
    } else {
        alert(data.message || "Failed to trigger proactive message");
    }
}

window.hideSuggestion = function () {
    const el = document.getElementById('proactive-suggestion');
    if (el) el.style.display = 'none';
}

window.killButler = async function () {
    if (!confirm("🚨 WARNING: This will immediately disable the Butler's autonomy and all proactive features. Proceed?")) return;

    try {
        const res = await fetch('/api/admin/kill-switch', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert("Butler Disabled Immediately.");
            setButlerMode('manual');
            // Permanently disable buttons in UI if needed, but for now just setting mode
        }
    } catch (e) {
        alert("Kill switch failed.");
    }
}

window.updateGuestEngagement = async function () {
    const level = document.getElementById('engagement-intensity').value;
    if (!activeGuestId) return;

    // Update the guest record via the existing update API
    const res = await fetch('/api/update-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeGuestId, engagementLevel: level })
    });
}

// --- SYSTEM SETTINGS ---
async function loadSystemSettings() {
    try {
        const res = await fetch('/api/wedding-context');
        const context = await res.json();

        if (context.emergencyContact) {
            const phoneInput = document.getElementById('config-sos-phone');
            const nameInput = document.getElementById('config-sos-name');
            if (phoneInput) phoneInput.value = context.emergencyContact.phone || '';
            if (nameInput) nameInput.value = context.emergencyContact.name || '';
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

async function saveSystemSettings() {
    const sosPhone = document.getElementById('config-sos-phone').value.trim();
    const sosName = document.getElementById('config-sos-name').value.trim();

    if (!sosPhone || !sosName) {
        alert("Please enter both SOS Name and Number.");
        return;
    }

    try {
        const res = await fetch('/api/wedding-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emergencyContact: {
                    phone: sosPhone,
                    name: sosName
                }
            })
        });

        const data = await res.json();
        if (data.success) {
            alert("✅ System Settings Saved!");
        } else {
            alert("❌ Failed to save settings: " + data.message);
        }
    } catch (e) {
        console.error("Error saving settings:", e);
        alert("Error saving settings. Check console.");
    }
}
// --- B14: WhatsApp Reconnect ---
async function reconnectWhatsApp() {
    if (!confirm("Are you sure you want to restart the WhatsApp connection?")) return;
    try {
        const res = await fetch('/api/admin/reconnect-whatsapp', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert("Reconnection process started. QR code will appear shortly.");
            document.getElementById('whatsapp-status').innerText = "Status: Reconnecting...";
        } else {
            alert("Error: " + data.message);
        }
    } catch (e) {
        alert("Failed to reach server.");
    }
}

// --- B5/B6: Admin Analytics ---
async function refreshAnalytics() {
    try {
        const res = await fetch('/api/admin/analytics');
        const data = await res.json();
        document.getElementById('stat-total-guests').innerText = data.totalGuests;
        document.getElementById('stat-active-chats').innerText = data.activeChats;
        document.getElementById('stat-urgent-cases').innerText = data.urgentCases;
        
    } catch (e) {
        console.error("Analytics refresh failed:", e);
    }
}

// --- B13: Knowledge Base Manager ---
let kbData = [];

async function loadKB() {
    try {
        const res = await fetch('/api/admin/kb');
        kbData = await res.json();
        renderKB(kbData);
    } catch (e) {
        console.error("KB load failed:", e);
    }
}

function renderKB(data) {
    const list = document.getElementById('kb-list');
    if (!list) return;
    if (data.length === 0) {
        list.innerHTML = `<span style="color:#999;">No facts in Knowledge Base.</span>`;
        return;
    }
    list.innerHTML = data.map(item => `
        <div style="padding:8px; border-bottom:1px solid rgba(197, 160, 40,0.1); display:flex; justify-content:space-between; align-items:flex-start;">
            <span style="flex:1; margin-right:10px;">${sanitizeHTML(item.text)}</span>
            <ion-icon name="trash-outline" onclick="deleteKBFact('${item.id}')" style="cursor:pointer; color:#d03e3e; min-width:14px;"></ion-icon>
        </div>
    `).join('');
}

function searchKB() {
    const term = document.getElementById('kb-search').value.toLowerCase();
    const filtered = kbData.filter(x => x.text.toLowerCase().includes(term));
    renderKB(filtered);
}

function openAddKBModal() { document.getElementById('kb-modal').classList.remove('hidden'); }
function closeKBModal() { document.getElementById('kb-modal').classList.add('hidden'); }

async function saveKBFact() {
    const text = document.getElementById('kb-text-input').value.trim();
    if (!text) return alert("Enter fact text");
    
    try {
        const res = await fetch('/api/admin/kb/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (data.success) {
            closeKBModal();
            document.getElementById('kb-text-input').value = "";
            loadKB();
        }
    } catch (e) { alert("Failed to save."); }
}

async function deleteKBFact(id) {
    if (!confirm("Are you sure?")) return;
    try {
        await fetch('/api/admin/kb/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        loadKB();
    } catch (e) { alert("Delete failed."); }
}
