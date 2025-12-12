"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluationService = exports.EvaluationService = void 0;
const openai_1 = require("openai");
const config_1 = require("../config");
const openai = new openai_1.OpenAI({
    apiKey: config_1.config.OPENAI_API_KEY,
});
class EvaluationService {
    async evaluateApplication(application, contextFiles) {
        const compliance = await this.assessCompliance(application, contextFiles);
        const risk = await this.assessRisk(application, contextFiles);
        const summary = await this.generateSummary(application, compliance, risk);
        return {
            applicationId: application.id,
            compliance,
            risk,
            summary,
            evaluatedAt: new Date(),
        };
    }
    async assessCompliance(application, contextFiles) {
        const context = contextFiles?.join('\n---\n') || 'No additional context provided.';
        const prompt = `You are a NOC compliance expert. Evaluate the following application for compliance issues.

Application Details:
Name: ${application.name}
Vendor: ${application.vendor}
Version: ${application.version}
Description: ${application.description}

Additional Context:
${context}

Provide a JSON response with:
{
  "compliant": boolean,
  "score": number (0-100),
  "issues": [{"severity": "critical|high|medium|low", "category": string, "description": string, "recommendation": string}],
  "recommendations": [string]
}`;
        const message = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2000,
        });
        try {
            const content = message.choices[0].message.content || '{}';
            return JSON.parse(content);
        }
        catch {
            return {
                compliant: true,
                score: 75,
                issues: [],
                recommendations: ['Manual review recommended'],
            };
        }
    }
    async assessRisk(application, contextFiles) {
        const context = contextFiles?.join('\n---\n') || 'No additional context provided.';
        const prompt = `You are a security risk assessment expert for NOC systems. Evaluate the following application for security risks.

Application Details:
Name: ${application.name}
Vendor: ${application.vendor}
Version: ${application.version}
Description: ${application.description}

Additional Context:
${context}

Provide a JSON response with:
{
  "riskLevel": "critical|high|medium|low",
  "riskScore": number (0-100),
  "threats": [{"type": string, "likelihood": "high|medium|low", "impact": "high|medium|low", "description": string}],
  "mitigations": [string]
}`;
        const message = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2000,
        });
        try {
            const content = message.choices[0].message.content || '{}';
            return JSON.parse(content);
        }
        catch {
            return {
                riskLevel: 'medium',
                riskScore: 50,
                threats: [],
                mitigations: ['Manual review recommended'],
            };
        }
    }
    async generateSummary(application, compliance, risk) {
        const prompt = `Create a concise executive summary (2-3 sentences) for NOC evaluation of:
Application: ${application.name} v${application.version}
Compliance Score: ${compliance.score}/100
Risk Level: ${risk.riskLevel}
Critical Issues: ${compliance.issues.filter(i => i.severity === 'critical').length}
Key Threats: ${risk.threats.slice(0, 2).map(t => t.type).join(', ')}`;
        const message = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2000,
        });
        return message.choices[0].message.content || 'Evaluation completed.';
    }
    async processVoiceQuery(query, applicationId) {
        const prompt = `You are a helpful NOC operations assistant. Answer this question about the NOC application evaluation:
Question: ${query}
Application ID: ${applicationId}

Provide a helpful, concise response that can be read aloud.`;
        const message = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1500,
        });
        return message.choices[0].message.content || 'I could not process your question.';
    }
    async generateTextToSpeech(text) {
        const speech = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'nova',
            input: text,
        });
        return Buffer.from(await speech.arrayBuffer());
    }
}
exports.EvaluationService = EvaluationService;
exports.evaluationService = new EvaluationService();
//# sourceMappingURL=evaluation.service.js.map