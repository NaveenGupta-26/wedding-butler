# Wedding Butler AI 👰🤵

The **Wedding Butler** is a smart, persona-driven AI concierge designed to manage guest communications and coordination for weddings. It replaces the chaos of multiple WhatsApp groups with a centralized, AI-powered assistant that answers questions, sends broadcasts, and handles emergencies.

---

## 🌟 Key Features

- **Persona-Driven AI**: Converses in natural Hinglish with tone adjustments based on the guest (Respectful for Elders, Playful for Siblings).
- **Full Context Memory**: Injects the entire Wedding Knowledge Base and Event Schedule into the AI for 100% accurate responses.
- **WhatsApp Integration**: Communicates directly with guests on their preferred platform.
- **Admin Dashboard**: A centralized panel to manage guests, track chats, train the AI, and send emergency broadcasts.
- **Real-Time SOS Alerts**: Dedicated emergency channel for guests to alert the Host immediately.
- **Proactive Notifications**: Automated reminders for event timings, dress codes, and venue changes.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **Real-Time**: Socket.io
- **AI Brain**: Google Gemini 2.0 Flash (Cloud-based for speed)
- **WhatsApp Engine**: whatsapp-web.js (Puppeteer)
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Mobile-first responsive design)

---

## 🚀 Quick Setup

### 1. Prerequisites
- Node.js (v18+)
- A Google AI (Gemini) API Key

### 2. Installation
```bash
git clone https://github.com/NaveenGupta-26/wedding-butler.git
cd wedding-butler
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_key_here
ADMIN_PASSWORD=your_secure_password
SESSION_SECRET=a_random_secret_string
PORT=5002
```

### 4. Running Locally
```bash
npm start
```
- **Admin Panel**: `http://localhost:5002/admin-login.html`
- **Guest App**: `http://localhost:5002/index.html`

---

## ☁️ Deployment (Render)

This project is optimized for deployment on **Render** as a Web Service.

1. Connect your GitHub repository.
2. Set Build Command: `npm install`
3. Set Start Command: `npm start`
4. Add Environment Variables (Gemini Key, Admin Pass, etc.)
5. **Note**: For WhatsApp to work on Render, ensure you set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and use the necessary buildpacks for Chrome/Puppeteer.

---

## 🛡️ Privacy & Security

- **Safe Defaults**: Strict `.gitignore` prevents private guest data, phone numbers, and WhatsApp sessions from ever being pushed to GitHub.
- **Local PII**: Guest phone numbers and chat history remain purely on your private instance.
- **Secure Sessions**: Uses encrypted cookies for both Admin and Guest authentication.

---

## 📝 Authors

- **Naveen Gupta** 

---

*Made with ❤️ for beautiful weddings.*
