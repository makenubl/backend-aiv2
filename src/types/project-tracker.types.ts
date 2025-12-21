/**
 * Project Tracker System Types
 * 
 * This module defines all types for the Project Activity Tracking system.
 * Design decisions:
 * - Separate from main types to maintain modularity
 * - Support for internal users, external employees, and vendors
 * - Full audit trail support for all changes
 * - AI extraction metadata for explainability
 */

import { ObjectId } from 'mongodb';

// =============================================================================
// ENUMS & CONSTANTS
// =============================================================================

export type TaskStatus = 'not-started' | 'in-progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type OwnerType = 'internal' | 'external' | 'vendor';
export type ProjectStatus = 'active' | 'on-hold' | 'completed' | 'archived';
export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// =============================================================================
// VENDOR & EXTERNAL USER TYPES
// =============================================================================

/**
 * Vendor entity - external company/organization
 * Vendors have limited portal access to update their assigned tasks
 */
export interface Vendor {
  _id?: ObjectId;
  vendorId: string;           // Unique identifier (e.g., VND-001)
  name: string;               // Company name
  contactName: string;        // Primary contact person
  contactEmail: string;       // Primary email for communications
  phone?: string;
  address?: string;
  category?: string;          // e.g., 'IT Services', 'Legal', 'Consulting'
  status: 'active' | 'inactive' | 'suspended';
  // Portal access credentials (hashed)
  portalEnabled: boolean;
  portalPasswordHash?: string;
  lastPortalLogin?: Date;
  // Metadata
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;          // Internal user who created this vendor
}

/**
 * External Employee - individuals not in the main user system
 * They can have limited portal access similar to vendors
 */
export interface ExternalEmployee {
  _id?: ObjectId;
  externalId: string;         // Unique identifier (e.g., EXT-001)
  name: string;
  email: string;
  phone?: string;
  organization?: string;      // Company they belong to (may reference Vendor)
  vendorId?: string;          // Optional link to vendor
  role?: string;              // Their role/title
  status: 'active' | 'inactive';
  // Portal access
  portalEnabled: boolean;
  portalPasswordHash?: string;
  lastPortalLogin?: Date;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

// =============================================================================
// PROJECT TYPES
// =============================================================================

/**
 * Project - top-level container for tasks
 * Projects can be linked to specific folders in the storage system
 */
export interface Project {
  _id?: ObjectId;
  projectId: string;          // Unique identifier (e.g., PRJ-001)
  name: string;
  description?: string;
  status: ProjectStatus;
  priority: TaskPriority;
  // Ownership
  ownerId: string;            // Internal user responsible for project
  ownerName: string;
  // Timeline
  startDate?: Date;
  targetEndDate?: Date;
  actualEndDate?: Date;
  // Associations
  linkedFolders?: string[];   // Storage folder names linked to this project
  tags?: string[];
  // Summary metrics (computed/cached)
  taskSummary?: {
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    notStarted: number;
  };
  // AI-generated insights (updated periodically)
  aiSummary?: ProjectAISummary;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * AI-generated project summary
 * Stored with the project and refreshed on demand or periodically
 */
export interface ProjectAISummary {
  generatedAt: Date;
  // Natural language summaries
  overallStatus: string;      // "Project is 65% complete with 3 blocked tasks"
  pendingItems: string;       // "5 tasks pending: 2 with vendors, 3 internal"
  bottlenecks: string;        // "Main bottleneck: Legal review pending for 2 weeks"
  riskAssessment: string;     // "Medium risk - timeline may slip by 1 week"
  recommendations: string[];  // ["Follow up with Vendor ABC", "Reassign task X"]
  // Structured data
  riskLevel: RiskLevel;
  estimatedDelayDays?: number;
  topBlockers: Array<{
    taskId: string;
    taskTitle: string;
    blockedDays: number;
    owner: string;
    ownerType: OwnerType;
  }>;
  // Dependency analysis
  pendingOnVendors: number;
  pendingOnInternal: number;
  pendingOnExternal: number;
}

// =============================================================================
// TASK TYPES
// =============================================================================

/**
 * Task - individual work item within a project
 * Can be created manually or extracted by AI from documents
 */
export interface Task {
  _id?: ObjectId;
  taskId: string;             // Unique identifier (e.g., TSK-001)
  projectId: string;          // Parent project
  // Task details
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  percentComplete: number;    // 0-100
  // Ownership - flexible to support all owner types
  ownerType: OwnerType;
  ownerId: string;            // Can be user email, vendorId, or externalId
  ownerName: string;          // Display name for UI
  // Timeline
  dueDate?: Date;
  startDate?: Date;
  completedDate?: Date;
  // Dependencies
  dependsOn?: string[];       // Other taskIds this depends on
  blockedBy?: string[];       // TaskIds blocking this task
  blockerReason?: string;     // If status is 'blocked', why?
  // Source tracking - for AI extraction audit trail
  sourceInfo?: TaskSourceInfo;
  // Updates history
  lastUpdatedBy?: string;
  lastUpdatedByType?: OwnerType;
  // Comments/notes
  comments?: TaskComment[];
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  isAIGenerated: boolean;     // True if created by AI extraction
  aiConfidence?: number;      // 0-1, AI's confidence in this extraction
}

/**
 * Information about where a task was extracted from
 * Enables full audit trail and explainability
 */
export interface TaskSourceInfo {
  sourceType: 'manual' | 'onedrive' | 'upload' | 'email';
  fileName?: string;
  filePath?: string;
  syncId?: string;            // Reference to OneDrive sync record
  extractedText?: string;     // The text AI extracted this from
  extractionReason?: string;  // AI's explanation of why this is a task
  pageNumber?: number;
  confidence: number;         // 0-1
}

/**
 * Task comment - for updates and discussions
 */
export interface TaskComment {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorType: OwnerType;
  createdAt: Date;
  isSystemGenerated?: boolean; // True for auto-generated comments
}

// =============================================================================
// ONEDRIVE SYNC TYPES
// =============================================================================

/**
 * OneDrive connection configuration
 * Stores OAuth tokens and sync settings
 */
export interface OneDriveConnection {
  _id?: ObjectId;
  connectionId: string;
  name: string;               // Friendly name for this connection
  // OAuth tokens (encrypted in storage)
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  // Connection details
  tenantId?: string;          // For organizational accounts
  driveId?: string;           // Specific drive if not default
  basePath?: string;          // Root folder to sync from
  // Sync settings
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt?: Date;
  nextSyncAt?: Date;
  // File filters
  includeFolders?: string[];  // Only sync these folders
  excludeFolders?: string[];  // Skip these folders
  fileTypes: string[];        // e.g., ['.docx', '.xlsx', '.pdf']
  // Status
  status: 'active' | 'inactive' | 'error';
  lastError?: string;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * OneDrive file sync record
 * Tracks each file synced and its processing status
 */
export interface OneDriveSyncRecord {
  _id?: ObjectId;
  syncId: string;             // Unique sync identifier
  connectionId: string;       // Which connection this came from
  // File info
  oneDriveItemId: string;     // OneDrive's item ID
  fileName: string;
  filePath: string;           // Full path in OneDrive
  fileSize: number;
  mimeType: string;
  // Version tracking
  version: number;            // Incremented each sync
  oneDriveETag?: string;      // For change detection
  lastModifiedInOneDrive: Date;
  // Local storage info
  localStoragePath?: string;  // Where we stored the copy
  localStorageType: 's3' | 'gridfs' | 'local';
  // Processing status
  syncStatus: SyncStatus;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processedAt?: Date;
  processingError?: string;
  // Extracted content
  extractedText?: string;     // Full text extracted from document
  extractedTaskCount?: number;
  // Project association
  projectId?: string;         // Which project this file belongs to
  // Metadata
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// ACTIVITY LOG TYPES
// =============================================================================

/**
 * Audit log entry for project tracker actions
 * Every significant action is logged for compliance
 */
export interface ProjectActivityLog {
  _id?: ObjectId;
  logId: string;
  timestamp: Date;
  // Action details
  action: string;             // e.g., 'task.created', 'task.status.changed'
  entityType: 'project' | 'task' | 'vendor' | 'external' | 'sync';
  entityId: string;
  // Who performed the action
  actorId: string;
  actorName: string;
  actorType: OwnerType | 'system';
  // Change details
  previousValue?: any;
  newValue?: any;
  description?: string;       // Human-readable description
  // Context
  ipAddress?: string;
  userAgent?: string;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

/**
 * Task update request from vendor/external portal
 * Limited fields that external users can update
 */
export interface VendorTaskUpdate {
  taskId: string;
  percentComplete?: number;
  status?: TaskStatus;
  comment?: string;
  blockerReason?: string;
}

/**
 * AI extraction request
 */
export interface AIExtractionRequest {
  projectId: string;
  syncId?: string;            // If from OneDrive
  fileName: string;
  content: string;            // Text content to analyze
  options?: {
    extractTasks: boolean;
    extractDeadlines: boolean;
    inferOwners: boolean;
  };
}

/**
 * AI extraction result
 */
export interface AIExtractionResult {
  success: boolean;
  tasks: Array<{
    title: string;
    description?: string;
    dueDate?: string;
    inferredOwner?: string;
    inferredOwnerType?: OwnerType;
    priority?: TaskPriority;
    confidence: number;
    sourceText: string;
    reasoning: string;
  }>;
  metadata: {
    documentType: string;
    processingTimeMs: number;
    tokensUsed?: number;
  };
}

/**
 * Dashboard filter options
 */
export interface TaskFilterOptions {
  projectId?: string;
  status?: TaskStatus[];
  ownerType?: OwnerType[];
  ownerId?: string;
  priority?: TaskPriority[];
  dueDateFrom?: Date;
  dueDateTo?: Date;
  isOverdue?: boolean;
  isBlocked?: boolean;
  searchQuery?: string;
}

/**
 * Dashboard aggregated stats
 */
export interface ProjectDashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByOwnerType: Record<OwnerType, number>;
  overdueTasks: number;
  blockedTasks: number;
  tasksCompletedThisWeek: number;
  avgCompletionRate: number;
  topBottlenecks: Array<{
    taskId: string;
    taskTitle: string;
    projectName: string;
    owner: string;
    daysPending: number;
  }>;
}

// =============================================================================
// COLLECTION NAMES
// =============================================================================

export const COLLECTION_NAMES = {
  PROJECTS: 'projects',
  TASKS: 'tasks',
  VENDORS: 'vendors',
  EXTERNAL_EMPLOYEES: 'external_employees',
  ONEDRIVE_CONNECTIONS: 'onedrive_connections',
  ONEDRIVE_SYNC_RECORDS: 'onedrive_sync_records',
  PROJECT_ACTIVITY_LOGS: 'project_activity_logs',
} as const;
