
const fs = require("fs/promises");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const CONFIG_PATH = path.join(__dirname, "env.json");
const QUIZ_PATH = path.join(__dirname, "quiz.json");

let timer = null;

/**
 * Load configuration.
 */
async function loadConfig() {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const config = JSON.parse(raw);

    if (!config.apiKey) {
        throw new Error("env.json: apiKey is missing.");
    }

    if (!config.model) {
        throw new Error("env.json: model is missing.");
    }

    if (
        !Number.isInteger(config.questionCount) ||
        config.questionCount <= 0
    ) {
        throw new Error(
            "env.json: questionCount must be a positive integer."
        );
    }

    if (
        typeof config.prompt !== "string" ||
        !config.prompt.trim()
    ) {
        throw new Error(
            "env.json: prompt must be a non-empty string."
        );
    }

    if (
        !Number.isInteger(config.answerTime) ||
        config.answerTime <= 0
    ) {
        throw new Error(
            "env.json: answerTime must be a positive integer."
        );
    }

    if (!/^\d{2}:\d{2}$/.test(config.fetchTime)) {
        throw new Error(
            "env.json: fetchTime must use HH:mm format."
        );
    }

    const [hour, minute] = config.fetchTime
        .split(":")
        .map(Number);

    if (hour > 23 || minute > 59) {
        throw new Error(
            "env.json: invalid fetchTime."
        );
    }

    return config;
}


/**
 * Generate the quiz using Gemini.
 */
async function fetchQuestions(config) {
    const ai = new GoogleGenAI({
        apiKey: config.apiKey
    });

    const prompt = `
${config.prompt}

IMPORTANT QUIZ RULES:

1. Generate EXACTLY ${config.questionCount} questions.
2. The questions array MUST contain exactly ${config.questionCount} items.
3. Do NOT generate fewer questions.
4. Do NOT generate more questions.
5. Every question must have exactly ONE correct answer.
6. Every answer MUST be exactly ONE WORD.
7. Do not use multi-word answers.
8. Avoid duplicate questions.
9. Do not include explanations.
10. Do not include introductions or conclusions.
11. Return only the requested JSON structure.

Generate a fresh set of questions.
`;

    const response = await ai.models.generateContent({
        model: config.model,

        contents: prompt,

        config: {
            responseMimeType: "application/json",

            responseSchema: {
                type: "object",

                properties: {
                    questions: {
                        type: "array",

                        items: {
                            type: "object",

                            properties: {
                                question: {
                                    type: "string"
                                },

                                answer: {
                                    type: "string"
                                }
                            },

                            required: [
                                "question",
                                "answer"
                            ]
                        }
                    }
                },

                required: [
                    "questions"
                ]
            }
        }
    });

    if (!response.text) {
        throw new Error(
            "Gemini returned an empty response."
        );
    }

    return JSON.parse(response.text);
}


/**
 * Generate and save today's quiz.
 */
async function generateDailyQuiz() {
    const config = await loadConfig();

    console.log(
        `Generating ${config.questionCount} anime questions...`
    );

    const modelResponse = await fetchQuestions(config);

    /*
     * We intentionally do not manually validate the
     * individual questions here.
     *
     * Gemini's structured output + prompt controls the
     * response format.
     */

    const quiz = {
        generatedAt: new Date().toISOString(),

        answerTime: config.answerTime,

        ...modelResponse
    };

    await fs.writeFile(
        QUIZ_PATH,
        JSON.stringify(quiz, null, 2),
        "utf8"
    );

    console.log(
        `Quiz saved to ${QUIZ_PATH}`
    );

    return quiz;
}


/**
 * Check if today's quiz already exists.
 */
async function alreadyGeneratedToday() {
    try {
        const raw = await fs.readFile(
            QUIZ_PATH,
            "utf8"
        );

        const quiz = JSON.parse(raw);

        if (!quiz.generatedAt) {
            return false;
        }

        const generated = new Date(
            quiz.generatedAt
        );

        const now = new Date();

        return (
            generated.getFullYear() === now.getFullYear() &&
            generated.getMonth() === now.getMonth() &&
            generated.getDate() === now.getDate()
        );
    } catch {
        return false;
    }
}


/**
 * Calculate milliseconds until next fetch time.
 */
function getDelayUntilNextRun(fetchTime) {
    const [hour, minute] = fetchTime
        .split(":")
        .map(Number);

    const now = new Date();

    const nextRun = new Date(now);

    nextRun.setHours(
        hour,
        minute,
        0,
        0
    );

    /*
     * If today's fetch time has already passed,
     * schedule for tomorrow.
     */
    if (nextRun <= now) {
        nextRun.setDate(
            nextRun.getDate() + 1
        );
    }

    return (
        nextRun.getTime() -
        now.getTime()
    );
}


/**
 * Initialize the daily quiz generator.
 *
 * Call this once from your delivery bot.
 */
async function initializeQuizFetcher() {
    const config = await loadConfig();

    /*
     * Prevent duplicate timers if initialization
     * happens more than once.
     */
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }


    /*
     * If the bot starts after today's scheduled
     * time and today's quiz doesn't exist,
     * generate it immediately.
     */
    if (!(await alreadyGeneratedToday())) {
        const [hour, minute] = config.fetchTime
            .split(":")
            .map(Number);

        const now = new Date();

        const scheduledToday = new Date(now);

        scheduledToday.setHours(
            hour,
            minute,
            0,
            0
        );

        if (now >= scheduledToday) {
            try {
                await generateDailyQuiz();
            } catch (error) {
                console.error(
                    "Initial quiz generation failed:",
                    error
                );
            }
        }
    }


    /**
     * Schedule next generation.
     */
    const scheduleNextRun = () => {
        const delay = getDelayUntilNextRun(
            config.fetchTime
        );

        console.log(
            `Next quiz generation scheduled for ${config.fetchTime}.`
        );

        timer = setTimeout(
            async () => {
                try {
                    await generateDailyQuiz();
                } catch (error) {
                    console.error(
                        "Daily quiz generation failed:",
                        error
                    );
                }

                /*
                 * Schedule the following day.
                 */
                scheduleNextRun();

            },
            delay
        );
    };

    scheduleNextRun();
}


/**
 * Stop the scheduler.
 */
function stopQuizFetcher() {
    if (timer) {
        clearTimeout(timer);

        timer = null;
    }
}


module.exports = {
    initializeQuizFetcher,
    generateDailyQuiz,
    stopQuizFetcher
};