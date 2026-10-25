const {
    initializeQuizFetcher
} = require("./quizmaker");

async function startBot() {
    await initializeQuizFetcher();

    // Start the delivery scheduler and answer collector.
    // Requiring it here (rather than at the top) ensures today's quiz
    // exists before the delivery window is scheduled.
    require("./creeper");
}

startBot().catch(console.error);