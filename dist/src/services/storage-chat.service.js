"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatAboutRecommendations = chatAboutRecommendations;
exports.listStorageChat = listStorageChat;
const openai_1 = require("openai");
const config_1 = require("../config");
const database_service_1 = require("./database.service");
const openai = new openai_1.OpenAI({ apiKey: config_1.config.OPENAI_API_KEY });
function summarizeRecommendations(trail) {
    const latest = trail[trail.length - 1];
    if (!latest)
        return 'No recommendations yet.';
    const counts = latest.recommendations.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
    }, {});
    return `Document ${latest.documentName} v${latest.version}: ${counts.pending || 0} pending, ${counts.accepted || 0} accepted, ${counts.rejected || 0} rejected.`;
}
async function chatAboutRecommendations(applicationId, documentName, message) {
    const trail = await (0, database_service_1.getRecommendationsTrail)(applicationId, documentName);
    await (0, database_service_1.insertChatMessage)(applicationId, documentName, 'user', message);
    // Heuristic: if user wants to apply/update, accept all pending on latest version
    const wantsApply = /apply|update|accept( all)? pending|fix now/i.test(message);
    let applied = [];
    if (wantsApply && trail.length) {
        const latest = trail[trail.length - 1];
        const pendingIds = latest.recommendations.filter(r => r.status === 'pending').map(r => r.id);
        if (pendingIds.length) {
            await (0, database_service_1.updateRecommendationStatus)(applicationId, latest.documentName, latest.version, pendingIds, 'accepted');
            applied = pendingIds;
        }
    }
    const history = await (0, database_service_1.listChatMessages)(applicationId, documentName, 30);
    if (!config_1.config.OPENAI_API_KEY) {
        const reply = applied.length
            ? `Applied ${applied.length} recommendations. ${summarizeRecommendations(trail)}`
            : `Here is the latest summary: ${summarizeRecommendations(trail)}`;
        await (0, database_service_1.insertChatMessage)(applicationId, documentName, 'assistant', reply);
        return { reply, applied, history };
    }
    const latestSummary = summarizeRecommendations(trail);
    const prompt = [
        'You are an AI assistant helping users act on AI-generated document recommendations.',
        'Be concise, optimistic, and actionable. If the user asks to apply or update, confirm if applied.',
        'Never hallucinate recommendation IDs; rely on the summary provided.',
        `Context: ${latestSummary}`,
        `User message: ${message}`,
        applied.length ? `System applied ${applied.length} recommendation(s) automatically.` : 'No automatic actions were taken.',
        'Respond in 2-4 concise sentences.'
    ].join('\n');
    const completion = await openai.chat.completions.create({
        model: config_1.config.OPENAI_MODEL || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 400
    });
    const reply = completion.choices[0]?.message?.content?.trim() || 'I reviewed the recommendations.';
    await (0, database_service_1.insertChatMessage)(applicationId, documentName, 'assistant', reply, undefined, applied.length ? [{ type: 'accept', ids: applied }] : undefined);
    return { reply, applied, history };
}
async function listStorageChat(applicationId, documentName) {
    return (0, database_service_1.listChatMessages)(applicationId, documentName, 30);
}
//# sourceMappingURL=storage-chat.service.js.map