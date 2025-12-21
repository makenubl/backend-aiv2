/**
 * Project Intelligence Service
 * 
 * Provides AI-powered analysis and summarization of project status,
 * bottlenecks, risks, and recommendations.
 * 
 * Design decisions:
 * - Generates human-readable summaries for management dashboards
 * - Identifies bottlenecks by analyzing task dependencies and staleness
 * - Risk assessment based on deadlines, completion rates, and blockers
 * - Periodic refresh with caching to minimize AI calls
 * - Structured output for programmatic use alongside natural language
 */

import { config } from '../config';
import { openAIRequestManager } from './openai-request-manager';
import {
  Project,
  Task,
  ProjectAISummary,
  RiskLevel,
  OwnerType,
  TaskStatus,
} from '../types/project-tracker.types';
import {
  getProjectById,
  getTasksByProject,
  getAllProjects,
  updateProject,
  getDashboardStats,
  getTasksGroupedByOwner,
  getVendorById,
  getExternalEmployeeById,
} from './project-tracker-db.service';

// =============================================================================
// CONFIGURATION
// =============================================================================

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

// Cache duration for AI summaries (1 hour)
const SUMMARY_CACHE_DURATION_MS = 60 * 60 * 1000;

// =============================================================================
// AI PROMPT TEMPLATES
// =============================================================================

const PROJECT_SUMMARY_SYSTEM_PROMPT = `You are an expert project manager AI providing executive-level status summaries.

Your summaries should be:
- CONCISE: No fluff, get to the point
- ACTIONABLE: Highlight what needs attention
- CLEAR: Avoid jargon, be specific
- HONEST: Don't sugarcoat problems

Focus on:
1. What work is currently ongoing
2. What work is pending and why
3. Who the work is pending with
4. Key risks and bottlenecks
5. Specific recommendations

Always provide context-aware insights, not generic statements.`;

const buildProjectSummaryPrompt = (
  project: Project,
  tasks: Task[],
  analysis: TaskAnalysis
): string => {
  const taskList = tasks.map(t => ({
    title: t.title,
    status: t.status,
    owner: t.ownerName,
    ownerType: t.ownerType,
    dueDate: t.dueDate?.toISOString().split('T')[0],
    percentComplete: t.percentComplete,
    isBlocked: t.status === 'blocked',
    blockerReason: t.blockerReason,
    daysOverdue: t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed'
      ? Math.floor((Date.now() - new Date(t.dueDate).getTime()) / (24 * 60 * 60 * 1000))
      : 0,
  }));

  return `Generate an executive summary for this project:

PROJECT: ${project.name}
Description: ${project.description || 'N/A'}
Status: ${project.status}
Target End Date: ${project.targetEndDate?.toISOString().split('T')[0] || 'Not set'}

TASK STATISTICS:
- Total tasks: ${analysis.total}
- Completed: ${analysis.completed} (${analysis.completionRate}%)
- In Progress: ${analysis.inProgress}
- Blocked: ${analysis.blocked}
- Not Started: ${analysis.notStarted}
- Overdue: ${analysis.overdue}

BY OWNER TYPE:
- Internal: ${analysis.byOwnerType.internal}
- External: ${analysis.byOwnerType.external}
- Vendor: ${analysis.byOwnerType.vendor}

TASK DETAILS:
${JSON.stringify(taskList, null, 2)}

Generate a JSON response with this exact structure:
{
  "overallStatus": "One sentence summary of overall project status",
  "pendingItems": "Summary of what's pending and why",
  "bottlenecks": "Main bottlenecks or blockers",
  "riskAssessment": "Risk level and reasoning",
  "recommendations": ["Action item 1", "Action item 2", "Action item 3"],
  "riskLevel": "low|medium|high|critical",
  "estimatedDelayDays": number or null
}

Be specific to THIS project's data. Don't be generic.`;
};

const PENDING_ON_WHOM_SYSTEM_PROMPT = `You are generating a report about work distribution and bottlenecks.

Focus on:
1. Who has the most pending work
2. Who is causing delays
3. What specific actions are needed
4. Vendor vs internal responsibility

Be direct and specific. Name names and tasks.`;

const buildPendingOnWhomPrompt = (
  groupedTasks: Map<string, { owner: string; type: OwnerType; tasks: Task[] }>
): string => {
  const groups = Array.from(groupedTasks.entries()).map(([_key, value]) => ({
    owner: value.owner,
    type: value.type,
    taskCount: value.tasks.length,
    tasks: value.tasks.map(t => ({
      title: t.title,
      status: t.status,
      dueDate: t.dueDate?.toISOString().split('T')[0],
      daysWaiting: Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / (24 * 60 * 60 * 1000)),
    })),
  })).sort((a, b) => b.taskCount - a.taskCount);

  return `Analyze work distribution across owners:

${JSON.stringify(groups, null, 2)}

Generate a JSON response:
{
  "summary": "Overall summary of who has pending work",
  "topBlockers": [
    {"owner": "name", "type": "internal|external|vendor", "taskCount": N, "analysis": "why they are blocking"},
  ],
  "recommendations": ["Specific action 1", "Specific action 2"],
  "riskAreas": ["Risk area 1", "Risk area 2"]
}`;
};

// =============================================================================
// TASK ANALYSIS (LOCAL COMPUTATION)
// =============================================================================

interface TaskAnalysis {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  notStarted: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
  avgDaysToComplete: number;
  byOwnerType: {
    internal: number;
    external: number;
    vendor: number;
  };
  blockedTasks: Array<{
    taskId: string;
    title: string;
    owner: string;
    ownerType: OwnerType;
    blockedDays: number;
    reason?: string;
  }>;
  overdueTasks: Array<{
    taskId: string;
    title: string;
    owner: string;
    daysOverdue: number;
  }>;
}

/**
 * Analyze tasks without AI - pure computation
 */
const analyzeTasksLocally = (tasks: Task[]): TaskAnalysis => {
  const now = new Date();
  
  const byStatus: Record<TaskStatus, Task[]> = {
    'not-started': [],
    'in-progress': [],
    'blocked': [],
    'completed': [],
    'cancelled': [],
  };
  
  const byOwnerType: Record<OwnerType, number> = {
    internal: 0,
    external: 0,
    vendor: 0,
  };
  
  const blockedTasks: TaskAnalysis['blockedTasks'] = [];
  const overdueTasks: TaskAnalysis['overdueTasks'] = [];
  
  let totalCompletionDays = 0;
  let completedCount = 0;
  
  for (const task of tasks) {
    byStatus[task.status].push(task);
    byOwnerType[task.ownerType]++;
    
    if (task.status === 'blocked') {
      const blockedDays = Math.floor(
        (now.getTime() - new Date(task.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
      );
      blockedTasks.push({
        taskId: task.taskId,
        title: task.title,
        owner: task.ownerName,
        ownerType: task.ownerType,
        blockedDays,
        reason: task.blockerReason,
      });
    }
    
    if (task.dueDate && new Date(task.dueDate) < now && 
        task.status !== 'completed' && task.status !== 'cancelled') {
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(task.dueDate).getTime()) / (24 * 60 * 60 * 1000)
      );
      overdueTasks.push({
        taskId: task.taskId,
        title: task.title,
        owner: task.ownerName,
        daysOverdue,
      });
    }
    
    if (task.status === 'completed' && task.completedDate && task.createdAt) {
      const days = Math.floor(
        (new Date(task.completedDate).getTime() - new Date(task.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      );
      totalCompletionDays += days;
      completedCount++;
    }
  }
  
  // Sort by severity
  blockedTasks.sort((a, b) => b.blockedDays - a.blockedDays);
  overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue);
  
  const total = tasks.length;
  const completed = byStatus.completed.length;
  
  return {
    total,
    completed,
    inProgress: byStatus['in-progress'].length,
    blocked: byStatus.blocked.length,
    notStarted: byStatus['not-started'].length,
    cancelled: byStatus.cancelled.length,
    overdue: overdueTasks.length,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgDaysToComplete: completedCount > 0 ? Math.round(totalCompletionDays / completedCount) : 0,
    byOwnerType,
    blockedTasks: blockedTasks.slice(0, 10), // Top 10
    overdueTasks: overdueTasks.slice(0, 10),
  };
};

/**
 * Determine risk level based on analysis
 */
const computeRiskLevel = (analysis: TaskAnalysis, project: Project): RiskLevel => {
  // Critical if many blocked or overdue tasks
  if (analysis.blocked >= 5 || analysis.overdue >= 5) {
    return 'critical';
  }
  
  // High if significant blockers or deadline pressure
  if (analysis.blocked >= 2 || analysis.overdue >= 3) {
    return 'high';
  }
  
  // Check deadline proximity
  if (project.targetEndDate) {
    const daysUntilDeadline = Math.floor(
      (new Date(project.targetEndDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    const remainingWork = analysis.total - analysis.completed - analysis.cancelled;
    
    if (daysUntilDeadline < 7 && remainingWork > 5) {
      return 'high';
    }
    if (daysUntilDeadline < 14 && remainingWork > 10) {
      return 'medium';
    }
  }
  
  // Medium if some blockers
  if (analysis.blocked > 0 || analysis.overdue > 0) {
    return 'medium';
  }
  
  return 'low';
};

// =============================================================================
// AI SUMMARY GENERATION
// =============================================================================

/**
 * Generate AI summary for a single project
 */
export const generateProjectSummary = async (
  projectId: string,
  forceRefresh: boolean = false
): Promise<ProjectAISummary> => {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  // Check cache
  if (!forceRefresh && project.aiSummary) {
    const summaryAge = Date.now() - new Date(project.aiSummary.generatedAt).getTime();
    if (summaryAge < SUMMARY_CACHE_DURATION_MS) {
      console.log(`📊 Using cached AI summary for project ${projectId}`);
      return project.aiSummary;
    }
  }
  
  console.log(`🤖 Generating AI summary for project: ${project.name}`);
  
  const tasks = await getTasksByProject(projectId);
  const analysis = analyzeTasksLocally(tasks);
  
  // Build prompt and call AI
  const prompt = buildProjectSummaryPrompt(project, tasks, analysis);
  
  const response = await openAIRequestManager.execute<string>({
    requestName: 'project-summary',
    promptSnippet: project.name,
    cacheKey: openAIRequestManager.buildCacheKey(
      'project-summary',
      projectId,
      tasks.length,
      analysis.completed
    ),
    operation: async () => {
      const apiResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.OPENAI_MODEL || 'gpt-4o',
          input: prompt,
          instructions: PROJECT_SUMMARY_SYSTEM_PROMPT,
        }),
      });
      
      if (!apiResponse.ok) {
        throw new Error(`OpenAI API error: ${apiResponse.statusText}`);
      }
      
      const data = await apiResponse.json() as {
        output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
        usage?: { input_tokens: number; output_tokens: number };
      };
      
      let responseText = '';
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                responseText = contentItem.text;
                break;
              }
            }
          }
        }
      }
      
      return { value: responseText, usage: data.usage };
    },
  });
  
  // Parse AI response
  let aiOutput: any = {};
  try {
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```json')) cleanResponse = cleanResponse.substring(7);
    if (cleanResponse.startsWith('```')) cleanResponse = cleanResponse.substring(3);
    if (cleanResponse.endsWith('```')) cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
    aiOutput = JSON.parse(cleanResponse.trim());
  } catch (error) {
    console.error('Failed to parse AI summary response:', error);
    aiOutput = {
      overallStatus: 'Unable to generate summary',
      pendingItems: 'Analysis pending',
      bottlenecks: 'Unable to determine',
      riskAssessment: 'Unable to assess',
      recommendations: [],
      riskLevel: computeRiskLevel(analysis, project),
    };
  }
  
  // Build full summary
  const summary: ProjectAISummary = {
    generatedAt: new Date(),
    overallStatus: aiOutput.overallStatus || `Project has ${analysis.total} tasks, ${analysis.completionRate}% complete`,
    pendingItems: aiOutput.pendingItems || `${analysis.notStarted + analysis.inProgress} tasks pending`,
    bottlenecks: aiOutput.bottlenecks || (analysis.blocked > 0 ? `${analysis.blocked} blocked tasks` : 'No major bottlenecks'),
    riskAssessment: aiOutput.riskAssessment || `Risk level: ${computeRiskLevel(analysis, project)}`,
    recommendations: aiOutput.recommendations || [],
    riskLevel: aiOutput.riskLevel || computeRiskLevel(analysis, project),
    estimatedDelayDays: aiOutput.estimatedDelayDays,
    topBlockers: analysis.blockedTasks.slice(0, 5).map(t => ({
      taskId: t.taskId,
      taskTitle: t.title,
      blockedDays: t.blockedDays,
      owner: t.owner,
      ownerType: t.ownerType,
    })),
    pendingOnVendors: tasks.filter(t => t.ownerType === 'vendor' && t.status !== 'completed').length,
    pendingOnInternal: tasks.filter(t => t.ownerType === 'internal' && t.status !== 'completed').length,
    pendingOnExternal: tasks.filter(t => t.ownerType === 'external' && t.status !== 'completed').length,
  };
  
  // Save to project
  await updateProject(projectId, { aiSummary: summary }, 'system', 'AI System');
  
  console.log(`✅ AI summary generated for project: ${project.name}`);
  
  return summary;
};

/**
 * Generate "pending on whom" analysis across all projects
 */
export const generatePendingOnWhomAnalysis = async (): Promise<{
  summary: string;
  topBlockers: Array<{
    owner: string;
    type: OwnerType;
    taskCount: number;
    analysis: string;
  }>;
  recommendations: string[];
  riskAreas: string[];
  byOwner: Map<string, { owner: string; type: OwnerType; tasks: Task[] }>;
}> => {
  console.log('🤖 Generating pending-on-whom analysis...');
  
  const taskGroups = await getTasksGroupedByOwner();
  
  // Resolve owner names
  const enrichedGroups = new Map<string, { owner: string; type: OwnerType; tasks: Task[] }>();
  
  for (const [key, tasks] of taskGroups.entries()) {
    const [type, id] = key.split(':') as [OwnerType, string];
    let ownerName = id;
    
    if (type === 'vendor') {
      const vendor = await getVendorById(id);
      ownerName = vendor?.name || id;
    } else if (type === 'external') {
      const external = await getExternalEmployeeById(id);
      ownerName = external?.name || id;
    }
    
    enrichedGroups.set(key, { owner: ownerName, type, tasks });
  }
  
  // Call AI for analysis
  const prompt = buildPendingOnWhomPrompt(enrichedGroups);
  
  const response = await openAIRequestManager.execute<string>({
    requestName: 'pending-on-whom',
    promptSnippet: 'all-projects',
    cacheKey: openAIRequestManager.buildCacheKey('pending-on-whom', enrichedGroups.size),
    operation: async () => {
      const apiResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.OPENAI_MODEL || 'gpt-4o',
          input: prompt,
          instructions: PENDING_ON_WHOM_SYSTEM_PROMPT,
        }),
      });
      
      if (!apiResponse.ok) {
        throw new Error(`OpenAI API error: ${apiResponse.statusText}`);
      }
      
      const data = await apiResponse.json() as {
        output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
        usage?: { input_tokens: number; output_tokens: number };
      };
      
      let responseText = '';
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                responseText = contentItem.text;
                break;
              }
            }
          }
        }
      }
      
      return { value: responseText, usage: data.usage };
    },
  });
  
  // Parse response
  let aiOutput: any = {};
  try {
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```json')) cleanResponse = cleanResponse.substring(7);
    if (cleanResponse.startsWith('```')) cleanResponse = cleanResponse.substring(3);
    if (cleanResponse.endsWith('```')) cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
    aiOutput = JSON.parse(cleanResponse.trim());
  } catch (error) {
    console.error('Failed to parse AI analysis:', error);
    aiOutput = {
      summary: 'Unable to generate analysis',
      topBlockers: [],
      recommendations: [],
      riskAreas: [],
    };
  }
  
  return {
    summary: aiOutput.summary || 'Analysis complete',
    topBlockers: aiOutput.topBlockers || [],
    recommendations: aiOutput.recommendations || [],
    riskAreas: aiOutput.riskAreas || [],
    byOwner: enrichedGroups,
  };
};

/**
 * Generate dashboard summary for all active projects
 */
export const generateDashboardSummary = async (): Promise<{
  stats: Awaited<ReturnType<typeof getDashboardStats>>;
  aiInsights: string;
  topActions: string[];
  riskSummary: string;
}> => {
  const stats = await getDashboardStats();
  
  // Generate AI insights based on stats
  const insightsPrompt = `Based on these project statistics, provide brief executive insights:

Total Projects: ${stats.totalProjects} (${stats.activeProjects} active)
Total Tasks: ${stats.totalTasks}
- Completed: ${stats.tasksByStatus.completed}
- In Progress: ${stats.tasksByStatus['in-progress']}
- Blocked: ${stats.tasksByStatus.blocked}
- Not Started: ${stats.tasksByStatus['not-started']}

By Owner Type:
- Internal: ${stats.tasksByOwnerType.internal}
- External: ${stats.tasksByOwnerType.external}
- Vendor: ${stats.tasksByOwnerType.vendor}

Overdue Tasks: ${stats.overdueTasks}
Tasks Completed This Week: ${stats.tasksCompletedThisWeek}
Average Completion Rate: ${stats.avgCompletionRate}%

Top Bottlenecks:
${stats.topBottlenecks.map(b => `- ${b.taskTitle} (${b.owner}) - pending ${b.daysPending} days`).join('\n')}

Provide a JSON response:
{
  "insights": "2-3 sentence executive summary",
  "topActions": ["Action 1", "Action 2", "Action 3"],
  "riskSummary": "One sentence risk overview"
}`;

  const response = await openAIRequestManager.execute<string>({
    requestName: 'dashboard-summary',
    promptSnippet: 'dashboard',
    cacheKey: openAIRequestManager.buildCacheKey(
      'dashboard-summary',
      stats.totalProjects,
      stats.totalTasks,
      stats.overdueTasks
    ),
    operation: async () => {
      const apiResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.OPENAI_MODEL || 'gpt-4o',
          input: insightsPrompt,
          instructions: 'You are a project management AI providing executive summaries. Be concise and actionable.',
        }),
      });
      
      if (!apiResponse.ok) {
        throw new Error(`OpenAI API error: ${apiResponse.statusText}`);
      }
      
      const data = await apiResponse.json() as {
        output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
        usage?: { input_tokens: number; output_tokens: number };
      };
      
      let responseText = '';
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                responseText = contentItem.text;
                break;
              }
            }
          }
        }
      }
      
      return { value: responseText, usage: data.usage };
    },
  });
  
  let aiOutput: any = {};
  try {
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```json')) cleanResponse = cleanResponse.substring(7);
    if (cleanResponse.startsWith('```')) cleanResponse = cleanResponse.substring(3);
    if (cleanResponse.endsWith('```')) cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
    aiOutput = JSON.parse(cleanResponse.trim());
  } catch (error) {
    aiOutput = {
      insights: `${stats.activeProjects} active projects with ${stats.tasksByStatus['in-progress']} tasks in progress.`,
      topActions: ['Review blocked tasks', 'Follow up on overdue items'],
      riskSummary: stats.overdueTasks > 0 ? `${stats.overdueTasks} tasks are overdue` : 'No critical risks identified',
    };
  }
  
  return {
    stats,
    aiInsights: aiOutput.insights,
    topActions: aiOutput.topActions,
    riskSummary: aiOutput.riskSummary,
  };
};

/**
 * Refresh all project summaries (for scheduled job)
 */
export const refreshAllProjectSummaries = async (): Promise<void> => {
  const projects = await getAllProjects({ status: ['active'] });
  
  console.log(`🔄 Refreshing AI summaries for ${projects.length} active projects`);
  
  for (const project of projects) {
    try {
      await generateProjectSummary(project.projectId, true);
    } catch (error) {
      console.error(`Error refreshing summary for ${project.name}:`, error);
    }
  }
  
  console.log('✅ All project summaries refreshed');
};

// =============================================================================
// EXPORT
// =============================================================================

export default {
  generateProjectSummary,
  generatePendingOnWhomAnalysis,
  generateDashboardSummary,
  refreshAllProjectSummaries,
};
