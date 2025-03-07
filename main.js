const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const chalk = require('chalk');
const figlet = require('figlet');
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

// Clear the terminal screen
function clearScreen() {
    console.clear();
}

// Display banner
function displayBanner() {
    const fontPath = path.resolve(__dirname, 'node_modules/figlet/fonts/small.flf');
    if (!fs.existsSync(fontPath)) {
        console.log(chalk.red('Font file "small.flf" is missing. Using default font.'));
        figlet.defaults({ font: 'Standard' });
    } else {
        figlet.defaults({ font: 'small' });
    }
    const bannerText = figlet.textSync('DARK DEVIL');
    clearScreen();
    const terminalWidth = process.stdout.columns || 80;
    const centeredBanner = bannerText.split('\n')
        .map(line => line.padStart((terminalWidth + line.length) / 2).padEnd(terminalWidth))
        .join('\n');
    console.log(chalk.cyan(centeredBanner));
    const authorLine = chalk.green('Author/Github: @AbdurRehman1129');
    console.log(authorLine.padStart((terminalWidth + authorLine.length) / 2).padEnd(terminalWidth));
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
                displayMenu(sock);
            }
        }
        if (events['creds.update']) {
            await saveCreds();
        }
    });
}

// Display menu
// Add to the displayMenu function
function displayMenu(sock) {
    clearScreen();
    displayBanner();
    const menu = `
-----------------------------------------
        WhatsApp Utility Menu
-----------------------------------------
1. Check WhatsApp Registration Status
2. Set or Change Personal WhatsApp Number
3. Exit
4. Check WhatsApp Registration (Comma-separated Numbers)
-----------------------------------------`;

    console.log(chalk.yellow(menu));
    process.stdout.write('Enter your choice: ');

    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', async (choice) => {
        choice = choice.trim();
        switch (choice) {
            case '1':
                await checkWhatsAppStatus(sock);
                break;
            case '2':
                await setPersonalNumber(sock);
                break;
            case '3':
                console.log('Exiting...');
                process.exit(0);
                break;
            case '4':
                await checkBulkWhatsAppStatus(sock);
                break;
            default:
                console.log(chalk.red('Invalid choice, please select again.'));
                displayMenu(sock);
                break;
        }
    });
}

// Add a new function to handle the bulk WhatsApp registration check
async function checkBulkWhatsAppStatus(sock) {
    process.stdout.write('Enter phone numbers (comma-separated, with country code): ');
    process.stdin.once('data', async (input) => {
        input = input.trim();
        const numbers = input.split(',').map(num => num.trim());
        let registeredNumbers = [];
        let notRegisteredNumbers = [];

        console.log(chalk.blue('Checking registration status...'));
        for (const num of numbers) {
            try {
                const isRegistered = await sock.onWhatsApp(num);
                if (isRegistered.length > 0) {
                    registeredNumbers.push(num);
                } else {
                    notRegisteredNumbers.push(num);
                }
            } catch (err) {
                console.log(chalk.red(`Error checking number ${num}:`, err));
            }
        }

        console.log(chalk.green('Registered Numbers:'), registeredNumbers.join(',') || 'None');
        console.log(chalk.red('Not Registered Numbers:'), notRegisteredNumbers.join(',') || 'None');

        // Send the summary to the personal WhatsApp number if set
        if (userPhoneNumber) {
            const resultSummary = `
Registered Numbers: ${registeredNumbers.join(',') || 'None'}
Not Registered Numbers: ${notRegisteredNumbers.join(',') || 'None'}
            `;
            try {
                await sock.sendMessage(userPhoneNumber + '@s.whatsapp.net', { text: resultSummary });
                console.log(chalk.green('Summary sent to your personal WhatsApp number.'));
            } catch (err) {
                console.log(chalk.red('Failed to send summary to personal number:', err));
            }
        } else {
            console.log(chalk.red('Personal WhatsApp number is not set.'));
        }

        process.stdout.write('Press Enter to return to the menu...');
        process.stdin.once('data', () => displayMenu(sock));
    });
}


// Function to set or change personal number
async function setPersonalNumber(sock) {
    process.stdout.write('Enter your personal WhatsApp number (with country code): ');
    process.stdin.once('data', (number) => {
        userPhoneNumber = number.trim();
        // Save the number to settings file
        fs.writeFileSync(settingsFile, JSON.stringify({ phoneNumber: userPhoneNumber }), 'utf-8');
        console.log(chalk.green('Your personal WhatsApp number has been saved.'));
        process.stdout.write('Press Enter to return to the menu...');
        process.stdin.once('data', () => displayMenu(sock));
    });
}

// Function to check WhatsApp registration status
async function checkWhatsAppStatus(sock) {
    process.stdout.write('Enter phone numbers with country code (comma-separated), or type "exit" to quit: ');
    process.stdin.once('data', async (input) => {
        input = input.trim();
        if (input.toLowerCase() === 'exit') {
            console.log('Exiting...');
            process.exit(0);
        } else {
            const numbers = input.split(',').map(num => num.trim());
            let registeredCount = 0;
            let notRegisteredCount = 0;
            let resultSummary = `List of Numbers Checked:\n`;

            for (const num of numbers) {
                try {
                    const isRegistered = await sock.onWhatsApp(num);
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
                    console.log(chalk.red(`Error checking number ${num}:`, err));
                }
            }

            const summary = `
Summary:
Registered: ${registeredCount}
Not Registered: ${notRegisteredCount}`;
            resultSummary += summary;
            console.log(chalk.yellow(resultSummary));

            // Send the result summary to the personal WhatsApp number
            if (userPhoneNumber) {
                try {
                    await sock.sendMessage(userPhoneNumber + '@s.whatsapp.net', { text: resultSummary });
                    console.log(chalk.green('Summary sent to your personal WhatsApp number.'));
                } catch (err) {
                    console.log(chalk.red('Failed to send summary to personal number:', err));
                }
            } else {
                console.log(chalk.red('Personal WhatsApp number is not set.'));
            }

            process.stdout.write('Press Enter to return to the menu...');
            process.stdin.once('data', () => displayMenu(sock));
        }
    });
}

// Start the script
(async () => {
    displayBanner();
    console.log(chalk.green('Initializing WhatsApp connection...'));
    await connectWhatsApp();
})();
