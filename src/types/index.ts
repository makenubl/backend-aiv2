export interface NOCApplication {
  id: string;
  name: string;
  description: string;
  vendor: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComplianceResult {
  compliant: boolean;
  score: number; // 0-100
  issues: ComplianceIssue[];
  recommendations: string[];
}

export interface ComplianceIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  recommendation: string;
}

export interface RiskAssessment {
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  riskScore: number; // 0-100
  threats: RiskThreat[];
  mitigations: string[];
}

export interface RiskThreat {
  type: string;
  likelihood: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  description: string;
}

export interface EvaluationResult {
  applicationId: string;
  compliance: ComplianceResult;
  risk: RiskAssessment;
  summary: string;
  evaluatedAt: Date;
}

export interface VoiceCommandRequest {
  audioBase64?: string;
  transcript?: string;
  applicationId: string;
}

export interface VoiceResponse {
  response: string;
  audioBase64?: string;
}
