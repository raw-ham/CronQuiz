const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Machine-specific settings (group id, API key, browser path, session path)
// live in env.json, which is gitignored so nothing leaks into version control.
let env = {};
try {
    env = require(path.join(__dirname, 'env.json'));
} catch {
    console.warn('env.json not found. Copy the example config from the README.');
}

const GROUP_ID = env.groupId;

const puppeteerOptions = { headless: true };
// Only override the browser if explicitly configured; otherwise Puppeteer
// uses its own bundled Chromium, so no absolute path is hardcoded here.
if (env.browserExecutablePath) {
    puppeteerOptions.executablePath = env.browserExecutablePath;
}

async function sendGroupMessage(groupId, message) {
    try {
        await client.sendMessage(groupId, message);
        console.log(`Message sent to ${groupId}`);
        return true;
    } catch (error) {
        console.error(`Failed to send message to ${groupId}:`, error);
        return false;
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: env.sessionPath || path.join(__dirname, 'session')
    }),
    puppeteer: puppeteerOptions
});

console.log('Initializing...');

client.once('ready', () => {
    console.log('Client is ready!');
});



client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});

client.on('message', async (msg) => {
    console.log('FROM:', msg.from);
    console.log('BODY:', msg.body);

    if (
        !msg.fromMe &&
        msg.body.trim().toLowerCase() === 'hello' &&
        msg.from.endsWith('@g.us')
    ) {
        try {
            await sendGroupMessage(GROUP_ID, 'Hello 👋');
            console.log('SENT');
        } catch (e) {
            console.error('SEND FAILED:', e);
        }
    }
});

client.initialize();