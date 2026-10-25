
const fs = require("fs/promises");
const path = require("path");

const QUIZ_PATH = path.join(__dirname, "quiz.json");
const CONFIG_PATH = path.join(__dirname, "env.json");
const RESPONSE_PATH = path.join(__dirname, "response.json");

let scheduledTimers = [];

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Machine-specific settings (group id, API key, browser path, session path)
// live in env.json, which is gitignored so nothing leaks into version control.
let env = {};
try {
    env = require(CONFIG_PATH);
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

client.on("message", async (msg) => {
    if (!msg.hasQuotedMsg) return;

    try {
        const quiz = JSON.parse(
            await fs.readFile(QUIZ_PATH, "utf8")
        );

        if (!Array.isArray(quiz.questions)) return;

        const userAnswer = msg.body
            .trim()
            .toLowerCase();

        if (!userAnswer) return;

        // Find the quiz question whose answer matches
        const question = quiz.questions.find(
            q =>
                typeof q.answer === "string" &&
                q.answer.trim().toLowerCase() === userAnswer
        );

        if (!question) return;

        // Load config
        const env = JSON.parse(
            await fs.readFile(CONFIG_PATH, "utf8")
        );

        const maxResponse = env.maxResponse;

        if (
            !Number.isInteger(maxResponse) ||
            maxResponse <= 0
        ) {
            throw new Error(
                "env.json: maxResponse must be a positive integer."
            );
        }

        // Load existing responses
        let responses = {};

        try {
            responses = JSON.parse(
                await fs.readFile(RESPONSE_PATH, "utf8")
            );
        } catch (err) {
            if (err.code !== "ENOENT") throw err;
        }

        const key = question.question;

        // Create entry for this question
        if (!responses[key]) {
            responses[key] = {
                question: question.question,
                answer: question.answer,
                responders: []
            };
        }

        const response = responses[key];

        // Maximum responders reached
        if (response.responders.length >= maxResponse) {
            return;
        }

        // Identify sender
        const userId = msg.author || msg.from;

        // Don't allow the same user to answer this question twice
        const alreadyResponded =
            response.responders.some(
                responder =>
                    responder.userId === userId
            );

        if (alreadyResponded) return;

        // Get sender's contact
        let contact = null;

        try {
            const contactObj = await msg.getContact();

            contact = {
                id: contactObj.id?._serialized || userId,
                pushname: contactObj.pushname || null
            };
        } catch (err) {
            console.error(
                "Could not retrieve contact:",
                err
            );

            contact = {
                id: userId
            };
        }

        // Add responder in order of correct answers
        response.responders.push({
            userId,
            contact,
            answeredAt: new Date().toISOString()
        });

        // Save response.json
        await fs.writeFile(
            RESPONSE_PATH,
            JSON.stringify(responses, null, 2),
            "utf8"
        );

        console.log(
            `Correct answer by ${userId}: ${question.question}`
        );

    } catch (error) {
        console.error(
            "Quiz listener error:",
            error
        );
    }
});

/**
 * ============================================================
 * YOUR DELIVERY FUNCTION
 * ============================================================
 *
 * DO NOT IMPLEMENT THIS HERE.
 *
 * Replace this placeholder with your existing delivery
 * function, or import it from your bot.
 *
 * Example:
 *
 * const { delivery } = require("./delivery");
 *
 */
async function delivery(question) {
    console.log(question.question);
    //await sendGroupMessage(GROUP_ID, question.question);
}


/**
 * Load env.json
 */
async function loadConfig() {
    const raw = await fs.readFile(
        CONFIG_PATH,
        "utf8"
    );

    return JSON.parse(raw);
}


/**
 * Load quiz.json
 */
async function loadQuiz() {
    const raw = await fs.readFile(
        QUIZ_PATH,
        "utf8"
    );

    return JSON.parse(raw);
}


/**
 * Convert HH:mm into minutes from midnight.
 *
 * Example:
 *
 * 09:30 -> 570
 * 18:00 -> 1080
 */
function timeToMinutes(time) {
    const [hour, minute] = time
        .split(":")
        .map(Number);

    if (
        Number.isNaN(hour) ||
        Number.isNaN(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        throw new Error(
            `Invalid time: ${time}`
        );
    }

    return hour * 60 + minute;
}


/**
 * Convert minutes from midnight back to HH:mm.
 */
function minutesToTime(minutes) {
    const hour = Math.floor(
        minutes / 60
    );

    const minute = minutes % 60;

    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}


/**
 * Generate X random time points between A and B.
 *
 * Each question gets one random time.
 */
function generateRandomTimes(
    count,
    startTime,
    endTime
) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);

    if (end <= start) {
        throw new Error(
            "deliveryEnd must be later than deliveryStart."
        );
    }

    const times = [];

    for (let i = 0; i < count; i++) {
        const randomMinute =
            Math.floor(
                Math.random() *
                (end - start + 1)
            ) + start;

        times.push(randomMinute);
    }

    return times;
}


/**
 * Create a Date object representing today's
 * occurrence of the specified HH:mm time.
 */
function createTodayDate(time) {
    const [hour, minute] = time
        .split(":")
        .map(Number);

    const date = new Date();

    date.setHours(
        hour,
        minute,
        0,
        0
    );

    return date;
}


/**
 * Schedule today's quiz.
 */
async function scheduleQuiz() {
    const config = await loadConfig();
    const quiz = await loadQuiz();

    if (
        !quiz.questions ||
        !Array.isArray(quiz.questions)
    ) {
        throw new Error(
            "quiz.json does not contain a questions array."
        );
    }

    const questions = quiz.questions;

    if (questions.length === 0) {
        throw new Error(
            "quiz.json contains no questions."
        );
    }


    /*
     * Generate one random time for every question.
     */
    const randomTimes = generateRandomTimes(
        questions.length,
        config.deliveryStart,
        config.deliveryEnd
    );


    /*
     * Pair each question with its scheduled time.
     */
    const schedule = questions.map(
        (question, index) => ({
            question,
            time: randomTimes[index]
        })
    );


    /*
     * Sort chronologically.
     */
    schedule.sort(
        (a, b) => a.time - b.time
    );


    console.log(
        `Scheduling ${schedule.length} quiz questions.`
    );

    console.log(
        `Delivery window: ${config.deliveryStart} - ${config.deliveryEnd}`
    );


    /*
     * Schedule each question.
     */
    for (const item of schedule) {
        const time = minutesToTime(
            item.time
        );

        const deliveryDate =
            createTodayDate(time);

        const delay =
            deliveryDate.getTime() -
            Date.now();


        /*
         * Don't schedule a time that has already
         * passed.
         */
        if (delay <= 0) {
            console.log(
                `Skipping ${time} because the time has passed.`
            );

            continue;
        }


        console.log(
            `Question scheduled for ${time}`
        );


        const timer = setTimeout(
            async () => {
                try {
                    await delivery(
                        item.question
                    );

                    console.log(
                        `Question delivered at ${time}`
                    );

                } catch (error) {
                    console.error(
                        `Failed to deliver question scheduled for ${time}:`,
                        error
                    );
                }
            },
            delay
        );


        scheduledTimers.push(timer);
    }
}


/**
 * Cancel all currently scheduled deliveries.
 */
function stopQuizScheduler() {
    for (const timer of scheduledTimers) {
        clearTimeout(timer);
    }

    scheduledTimers = [];

    console.log(
        "Quiz scheduler stopped."
    );
}


/**
 * Initialize the scheduler.
 *
 * Call this from your main bot.
 */
async function initializeQuizScheduler() {
    stopQuizScheduler();

    await scheduleQuiz();
}


client.initialize();
initializeQuizScheduler();

module.exports = {
    initializeQuizScheduler,
    scheduleQuiz,
    stopQuizScheduler
};