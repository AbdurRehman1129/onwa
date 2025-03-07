const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const P = require('pino');

// Logger configuration
const logger = P({ level: 'silent' }); // Suppress logs

// Load personal number from file (if exists)
const settingsFile = 'settings.json';
let userPhoneNumber = '';

if (fs.existsSync(settingsFile)) {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    userPhoneNumber = settings.phoneNumber || '';
}

// Connect to WhatsApp
async function connectWhatsApp() {
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
                const isLoggedOut = lastDisconnect?.error?.output?.statusCode === 401; // Handle logout explicitly
                if (isLoggedOut) {
                    console.log(chalk.red('Logged out. Please delete the auth folder and re-run the script.'));
                    process.exit(1);
                }
                const shouldReconnect = !isLoggedOut;
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'));
                    await connectWhatsApp();
                }
            } else if (connection === 'open') {
                console.log(chalk.green('WhatsApp connected!'));
            }
        }
        if (events['creds.update']) {
            await saveCreds();
        }
    });

    // Start listening for messages from WhatsApp
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        const sender = message.key.remoteJid;

        if (message.message && message.message.conversation) {
            const text = message.message.conversation.trim();

            if (text.startsWith('.check')) {
                const phoneNumbers = text.replace('.check', '').trim();
                await checkWhatsAppStatus(sock, sender, phoneNumbers);
            }
        }
    });
}

// Function to check WhatsApp registration status
async function checkWhatsAppStatus(sock, sender, numbers) {
    let resultSummary = 'List of Numbers Checked:\n';
    let registeredCount = 0;
    let notRegisteredCount = 0;

    // Trim spaces around each number and split by commas
    const cleanedNumbers = numbers.split(',').map(num => num.trim());

    for (const num of cleanedNumbers) {
        try {
            const isRegistered = await sock.onWhatsApp(num + '@s.whatsapp.net');
            const statusMessage = isRegistered.length > 0
                ? `${num} is registered on WhatsApp.`
                : `${num} is NOT registered on WhatsApp.`;
            resultSummary += `${statusMessage}\n`;
            if (isRegistered.length > 0) {
                registeredCount++;
            } else {
                notRegisteredCount++;
            }
        } catch (err) {
            resultSummary += `Error checking ${num}: ${err}\n`;
        }
    }

    const summary = `
Summary:
Registered: ${registeredCount}
Not Registered: ${notRegisteredCount}`;
    resultSummary += summary;

    // Send the result to the user
    await sock.sendMessage(sender, { text: resultSummary });
}

// Dummy Express server for health checks
const app = express();
app.get('/', (req, res) => {
    res.send('WhatsApp bot is running.');
});

// Start server on port 8000 (default for Koyeb health checks)
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Health check server running on port ${PORT}`));

// Start the script
(async () => {
    console.log(chalk.green('Initializing WhatsApp connection...'));
    await connectWhatsApp();
})();
