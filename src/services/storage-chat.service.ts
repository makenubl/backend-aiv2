import { OpenAI } from 'openai';
import { config } from '../config';
import { getRecommendationsTrail, updateRecommendationStatus, insertChatMessage, listChatMessages } from './database.service';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

function summarizeRecommendations(trail: Awaited<ReturnType<typeof getRecommendationsTrail>>) {
  const latest = trail[trail.length - 1];
  if (!latest) return 'No recommendations yet.';
  const counts = latest.recommendations.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return `Document ${latest.documentName} v${latest.version}: ${counts.pending || 0} pending, ${counts.accepted || 0} accepted, ${counts.rejected || 0} rejected.`;
}

export async function chatAboutRecommendations(
  applicationId: string,
  documentName: string | undefined,
  message: string
): Promise<{ reply: string; applied?: string[]; history: any[] }> {
  const trail = await getRecommendationsTrail(applicationId, documentName);
  await insertChatMessage(applicationId, documentName, 'user', message);

  // Heuristic: if user wants to apply/update, accept all pending on latest version
  const wantsApply = /apply|update|accept( all)? pending|fix now/i.test(message);
  let applied: string[] = [];
  if (wantsApply && trail.length) {
    const latest = trail[trail.length - 1];
    const pendingIds = latest.recommendations.filter(r => r.status === 'pending').map(r => r.id);
    if (pendingIds.length) {
      await updateRecommendationStatus(applicationId, latest.documentName, latest.version, pendingIds, 'accepted');
      applied = pendingIds;
    }
  }

  const history = await listChatMessages(applicationId, documentName, 30);

  if (!config.OPENAI_API_KEY) {
    const reply = applied.length
      ? `Applied ${applied.length} recommendations. ${summarizeRecommendations(trail)}`
      : `Here is the latest summary: ${summarizeRecommendations(trail)}`;
    await insertChatMessage(applicationId, documentName, 'assistant', reply);
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
    model: config.OPENAI_MODEL || 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 400
  });

  const reply = completion.choices[0]?.message?.content?.trim() || 'I reviewed the recommendations.';
  await insertChatMessage(applicationId, documentName, 'assistant', reply, undefined, applied.length ? [{ type: 'accept', ids: applied }] : undefined);

  return { reply, applied, history };
}

export async function listStorageChat(applicationId: string, documentName?: string): Promise<Awaited<ReturnType<typeof listChatMessages>>> {
  return listChatMessages(applicationId, documentName, 30);
}
