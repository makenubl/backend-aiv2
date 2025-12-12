import { OpenAI } from 'openai';
import { config } from '../config';
import {
  NOCApplication,
  ComplianceResult,
  RiskAssessment,
  EvaluationResult,
} from '../types';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Logging utility for LLM calls
function logLLMCall(operation: string, model: string, tokens?: number, duration?: number) {
  const timestamp = new Date().toISOString();
  console.log(`[LLM] ${timestamp} | Operation: ${operation} | Model: ${model}${tokens ? ` | Tokens: ${tokens}` : ''}${duration ? ` | Duration: ${duration}ms` : ''}`);
}

// Calculate weighted evaluation score
function calculateOverallScore(compliance: ComplianceResult, risk: RiskAssessment): number {
  const complianceScore = compliance.score;
  const securityScore = 100 - risk.riskScore; // Invert risk score for security score
  const documentationScore = compliance.issues.length === 0 ? 100 : Math.max(0, 100 - (compliance.issues.length * 10));
  const technicalScore = risk.threats.length === 0 ? 100 : Math.max(0, 100 - (risk.threats.length * 15));

  const weights = config.EVALUATION_WEIGHTS;
  const overallScore = 
    (complianceScore * weights.COMPLIANCE) +
    (securityScore * weights.SECURITY) +
    (documentationScore * weights.DOCUMENTATION) +
    (technicalScore * weights.TECHNICAL);

  return Math.round(overallScore);
}

// Determine risk level based on score
function determineRiskLevel(riskScore: number): 'critical' | 'high' | 'medium' | 'low' {
  const thresholds = config.RISK_THRESHOLDS;
  if (riskScore >= thresholds.CRITICAL) return 'critical';
  if (riskScore >= thresholds.HIGH) return 'high';
  if (riskScore >= thresholds.MEDIUM) return 'medium';
  return 'low';
}

export class EvaluationService {
  // Single-call evaluation to reduce OpenAI usage
  async evaluateApplicationSingleCall(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n📊 [EVALUATION START] Application: ${application.name} v${application.version}`);
    console.log(`🔧 Using LLM Model: ${config.OPENAI_MODEL}`);
    console.log(`📋 Max Tokens: ${config.OPENAI_MAX_TOKENS}`);
    console.log(`⚖️  Evaluation Weights: Compliance=${config.EVALUATION_WEIGHTS.COMPLIANCE * 100}%, Security=${config.EVALUATION_WEIGHTS.SECURITY * 100}%, Docs=${config.EVALUATION_WEIGHTS.DOCUMENTATION * 100}%, Technical=${config.EVALUATION_WEIGHTS.TECHNICAL * 100}%`);

    const prompt = `You are a Pakistan VASP NOC evaluator. Analyze the application and return ONE JSON block containing compliance, risk, and an executive summary.

Application Details:
Name: ${application.name}
Vendor: ${application.vendor}
Version: ${application.version}
Description: ${application.description}

Additional Context (filenames or snippets):
${context}

Respond strictly as JSON with the schema:
{
  "compliance": {
    "compliant": boolean,
    "score": number,
    "issues": [{"severity": "critical|high|medium|low", "category": string, "description": string, "recommendation": string}],
    "recommendations": [string]
  },
  "risk": {
    "riskLevel": "critical|high|medium|low",
    "riskScore": number,
    "threats": [{"type": string, "likelihood": "high|medium|low", "impact": "high|medium|low", "description": string}],
    "mitigations": [string]
  },
  "summary": string
}`;

    const message = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    const tokensUsed = message.usage?.total_tokens || 0;
    logLLMCall('evaluateApplicationSingleCall', config.OPENAI_MODEL, tokensUsed, duration);

    try {
      const content = message.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      
      const compliance = parsed.compliance || { compliant: true, score: 75, issues: [], recommendations: ['Manual review recommended'] };
      const risk = parsed.risk || { riskLevel: 'medium', riskScore: 50, threats: [], mitigations: ['Manual review recommended'] };
      const overallScore = calculateOverallScore(compliance, risk);
      
      console.log(`✅ [EVALUATION COMPLETE] Overall Score: ${overallScore}/100`);
      console.log(`   Compliance: ${compliance.score}/100 | Risk: ${risk.riskLevel} (${risk.riskScore}/100)`);
      console.log(`   Issues: ${compliance.issues.length} | Threats: ${risk.threats.length}`);
      
      return {
        applicationId: application.id,
        compliance,
        risk,
        summary: parsed.summary || 'Evaluation completed.',
        evaluatedAt: new Date(),
      };
    } catch (error) {
      console.error(`❌ [EVALUATION ERROR] Failed to parse LLM response:`, error);
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
  }
  async evaluateApplication(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<EvaluationResult> {
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

  private async assessCompliance(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<ComplianceResult> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n🔍 [COMPLIANCE CHECK] Assessing compliance for ${application.name}`);

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
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('assessCompliance', config.OPENAI_MODEL, message.usage?.total_tokens, duration);

    try {
      const content = message.choices[0].message.content || '{}';
      const result = JSON.parse(content);
      console.log(`   ✓ Compliance Score: ${result.score}/100 | Issues: ${result.issues?.length || 0}`);
      return result;
    } catch (error) {
      console.error(`   ✗ Failed to parse compliance response:`, error);
      return {
        compliant: true,
        score: 75,
        issues: [],
        recommendations: ['Manual review recommended'],
      };
    }
  }

  private async assessRisk(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<RiskAssessment> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n🛡️  [RISK ASSESSMENT] Analyzing security risks for ${application.name}`);

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
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('assessRisk', config.OPENAI_MODEL, message.usage?.total_tokens, duration);

    try {
      const content = message.choices[0].message.content || '{}';
      const result = JSON.parse(content);
      const calculatedLevel = determineRiskLevel(result.riskScore);
      result.riskLevel = calculatedLevel; // Override with calculated risk level
      console.log(`   ✓ Risk Level: ${result.riskLevel} (${result.riskScore}/100) | Threats: ${result.threats?.length || 0}`);
      return result;
    } catch (error) {
      console.error(`   ✗ Failed to parse risk response:`, error);
      return {
        riskLevel: 'medium',
        riskScore: 50,
        threats: [],
        mitigations: ['Manual review recommended'],
      };
    }
  }

  private async generateSummary(
    application: NOCApplication,
    compliance: ComplianceResult,
    risk: RiskAssessment
  ): Promise<string> {
    const startTime = Date.now();
    const overallScore = calculateOverallScore(compliance, risk);
    
    console.log(`\n📝 [SUMMARY GENERATION] Creating executive summary`);
    
    const prompt = `Create a concise executive summary (2-3 sentences) for NOC evaluation of:
Application: ${application.name} v${application.version}
Overall Score: ${overallScore}/100
Compliance Score: ${compliance.score}/100
Risk Level: ${risk.riskLevel}
Critical Issues: ${compliance.issues.filter(i => i.severity === 'critical').length}
Key Threats: ${risk.threats.slice(0, 2).map(t => t.type).join(', ')}`;

    const message = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('generateSummary', config.OPENAI_MODEL, message.usage?.total_tokens, duration);

    return message.choices[0].message.content || 'Evaluation completed.';
  }

  async processVoiceQuery(query: string, applicationId: string): Promise<string> {
    const startTime = Date.now();
    console.log(`\n🎤 [VOICE QUERY] Processing: "${query}" for app ${applicationId}`);
    
    const prompt = `You are a helpful NOC operations assistant. Answer this question about the NOC application evaluation:
Question: ${query}
Application ID: ${applicationId}

Provide a helpful, concise response that can be read aloud.`;

    const message = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 1500,
    });

    const duration = Date.now() - startTime;
    logLLMCall('processVoiceQuery', config.OPENAI_MODEL, message.usage?.total_tokens, duration);

    return message.choices[0].message.content || 'I could not process your question.';
  }

  async generateTextToSpeech(text: string): Promise<Buffer> {
    const speech = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
    });

    return Buffer.from(await speech.arrayBuffer());
  }
}

export const evaluationService = new EvaluationService();
