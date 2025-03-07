const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const http = require('http');

// Logger configuration
const logger = P({ level: 'silent' }); // Suppress logs

// Load personal number from file (if exists)
const settingsFile = 'settings.json';
let userPhoneNumber = '';

if (fs.existsSync(settingsFile)) {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    userPhoneNumber = settings.phoneNumber || '';
}

// Function to connect to WhatsApp
async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth');
        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            version: version,
            logger: logger, // Suppress logs
        });

        sock.ev.process(async events => {
            if (events['connection.update']) {
                const { connection, lastDisconnect } = events['connection.update'];
                if (connection === 'close') {
                    const isLoggedOut = lastDisconnect?.error?.output?.statusCode === 401;
                    if (isLoggedOut) {
                        console.log(chalk.red('Logged out. Deleting session and restarting.'));
                        fs.rmSync('auth', { recursive: true, force: true });
                        process.exit(1);
                    }
                    console.log(chalk.yellow('Reconnecting...'));
                    await connectWhatsApp();
                } else if (connection === 'open') {
                    console.log(chalk.green('WhatsApp connected!'));
                }
            }
            if (events['creds.update']) {
                await saveCreds();
            }
        });

        // Handle incoming messages
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message) return;
                const sender = message.key.remoteJid;
                const text = message.message.conversation?.trim() || '';

                if (text.startsWith('.check')) {
                    const phoneNumbers = text.replace('.check', '').trim();
                    await checkWhatsAppStatus(sock, sender, phoneNumbers);
                }
            } catch (error) {
                console.error("Error processing message:", error);
                if (error.message.includes("Bad MAC")) {
                    console.log("Clearing session due to Bad MAC error...");
                    fs.rmSync('auth', { recursive: true, force: true });
                    process.exit(1);
                }
            }
        });
    } catch (err) {
        console.error("Error initializing WhatsApp connection:", err);
        setTimeout(connectWhatsApp, 5000); // Retry after 5 seconds
    }
}

// Function to check WhatsApp registration status
async function checkWhatsAppStatus(sock, sender, numbers) {
    let resultSummary = 'List of Numbers Checked:\n';
    let registeredCount = 0;
    let notRegisteredCount = 0;
    const cleanedNumbers = numbers.split(',').map(num => num.trim());

    for (const num of cleanedNumbers) {
        try {
            const isRegistered = await sock.onWhatsApp(num + '@s.whatsapp.net');
            const statusMessage = isRegistered.length > 0
                ? `${num} is registered on WhatsApp.`
                : `${num} is NOT registered on WhatsApp.`;
            resultSummary += `${statusMessage}\n`;
            if (isRegistered.length > 0) registeredCount++;
            else notRegisteredCount++;
        } catch (err) {
            resultSummary += `Error checking ${num}: ${err}\n`;
        }
    }
    resultSummary += `\nSummary:\nRegistered: ${registeredCount}\nNot Registered: ${notRegisteredCount}`;
    await sock.sendMessage(sender, { text: resultSummary });
}

// Express server for health checks
const app = express();
app.get('/', (req, res) => {
    res.send('WhatsApp bot is running.');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Health check server running on port ${PORT}`));

// Self-pinging to prevent Koyeb from sleeping
setInterval(() => {
    http.get(`http://localhost:${PORT}`, (res) => {
        console.log("Keep-alive ping sent.");
    }).on("error", (err) => {
        console.log("Keep-alive error:", err.message);
    });
}, 5 * 60 * 1000); // Ping every 5 minutes

// Start the bot
(async () => {
    console.log(chalk.green('Initializing WhatsApp connection...'));
    await connectWhatsApp();
})();