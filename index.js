const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const P = require("pino");
const chalk = require("chalk");
const fs = require("fs");

// Function to connect WhatsApp
async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth');
        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            version: version,
            logger: P({ level: 'silent' }),
        });

        // Handle connection events
        sock.ev.process(async events => {
            if (events['connection.update']) {
                const { connection, lastDisconnect } = events['connection.update'];
                if (connection === 'close') {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                    if (shouldReconnect) {
                        console.log(chalk.yellow('Reconnecting...'));
                        await connectWhatsApp();
                    } else {
                        console.log(chalk.red('Logged out. Delete the auth folder and restart.'));
                        process.exit(1);
                    }
                } else if (connection === 'open') {
                    console.log(chalk.green('WhatsApp connected!'));
                    keepAlive(sock);
                }
            }
            if (events['creds.update']) {
                await saveCreds();
            }
        });

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (!message || !message.key) return;

            try {
                const sender = message.key.remoteJid;
                const text = message.message?.conversation?.trim();

                if (text?.startsWith('.check')) {
                    const phoneNumbers = text.replace('.check', '').trim();
                    await checkWhatsAppStatus(sock, sender, phoneNumbers);
                }
            } catch (err) {
                console.error(chalk.red('Error processing message:', err));
            }
        });

        return sock;
    } catch (error) {
        console.error(chalk.red('Session error:', error));
        console.log(chalk.yellow('Restarting connection...'));
        setTimeout(connectWhatsApp, 5000); // Retry after 5 seconds
    }
}

// Function to check WhatsApp number status
async function checkWhatsAppStatus(sock, sender, phoneNumbers) {
    try {
        if (!phoneNumbers) {
            await sock.sendMessage(sender, { text: '❌ Please provide a phone number after `.check`' });
            return;
        }
        const result = await sock.onWhatsApp(phoneNumbers);
        if (result.length > 0) {
            await sock.sendMessage(sender, { text: `✅ Number *${phoneNumbers}* is on WhatsApp!` });
        } else {
            await sock.sendMessage(sender, { text: `❌ Number *${phoneNumbers}* is NOT on WhatsApp.` });
        }
    } catch (err) {
        console.error(chalk.red('Error checking number:', err));
        await sock.sendMessage(sender, { text: '⚠️ Error checking number. Please try again.' });
    }
}

// Function to keep the bot active
async function keepAlive(sock) {
    setInterval(async () => {
        try {
            await sock.sendPresenceUpdate('available');
            console.log(chalk.blue('✅ Self-ping sent to keep session alive.'));
        } catch (err) {
            console.error(chalk.red('Error in self-pinging:', err));
        }
    }, 60000); // Every 60 seconds
}

// Start the bot
connectWhatsApp();
