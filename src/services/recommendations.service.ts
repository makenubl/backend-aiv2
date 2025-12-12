import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { documentAnalyzerService } from './document-analyzer.service';
import { saveRecommendationsVersion, getRecommendationsTrail, updateRecommendationStatus } from './database.service';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface GeneratedRecommendation {
  id: string;
  point: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

async function readFileText(filePath: string): Promise<string> {
  try {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.pdf')) {
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text || '';
    }
    if (lower.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    // Fallback to plain text
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export async function generateRecommendationsForUpload(applicationId: string, documentPath: string, documentName: string): Promise<{ version: number; recommendations: GeneratedRecommendation[]; extract: string }>{
  const trails = await getRecommendationsTrail(applicationId, documentName);
  const nextVersion = (trails[trails.length - 1]?.version || 0) + 1;

  const extract = await readFileText(documentPath);

  // Use AI categorization signals to craft recommendation points
  let points: string[] = [];
  try {
    const companyName = applicationId;
    const aiCat = await documentAnalyzerService.categorizeDocumentWithAI(applicationId, companyName, documentPath, documentName);
    points = [
      `Ensure ${aiCat.category} - ${aiCat.subcategory} documentation complies with standards`,
      `Add missing references or sections related to ${aiCat.category}`
    ];
  } catch {
    // Fallback generic suggestions
    points = [
      'Clarify scope and objectives',
      'Provide references to applicable regulations',
      'Add version and change history in the document'
    ];
  }

  const recommendations: GeneratedRecommendation[] = points.map(p => ({ id: uuidv4(), point: p, status: 'pending', createdAt: new Date() }));
  await saveRecommendationsVersion(applicationId, documentName, nextVersion, recommendations, extract);
  return { version: nextVersion, recommendations, extract };
}

export async function acceptOrRejectRecommendations(applicationId: string, documentName: string, version: number, acceptIds: string[], rejectIds: string[]) {
  if (acceptIds?.length) {
    await updateRecommendationStatus(applicationId, documentName, version, acceptIds, 'accepted');
  }
  if (rejectIds?.length) {
    await updateRecommendationStatus(applicationId, documentName, version, rejectIds, 'rejected');
  }
}

export async function listRecommendations(applicationId: string, documentName?: string): Promise<ReturnType<typeof getRecommendationsTrail>> {
  return await getRecommendationsTrail(applicationId, documentName);
}
