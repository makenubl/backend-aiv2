/**
 * Project Tracker Database Service
 * 
 * Handles all database operations for the Project Activity Tracking system.
 * Uses the existing MongoDB connection from database.service.ts
 * 
 * Design decisions:
 * - Separate service file to keep main database.service clean
 * - Uses same connection pattern as existing code
 * - Comprehensive indexing for performance
 * - Full audit logging for all mutations
 */

import { Collection, Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  Project,
  Task,
  Vendor,
  ExternalEmployee,
  OneDriveConnection,
  OneDriveSyncRecord,
  ProjectActivityLog,
  TaskStatus,
  OwnerType,
  ProjectStatus,
  TaskFilterOptions,
  ProjectDashboardStats,
  VendorTaskUpdate,
  COLLECTION_NAMES,
} from '../types/project-tracker.types';

// We'll get the database instance from the main database service
let database: Db;

/**
 * Initialize the project tracker database with proper indexes
 * Call this after main database connection is established
 */
export const initializeProjectTrackerDb = async (db: Db): Promise<void> => {
  database = db;
  
  console.log('📊 Initializing Project Tracker collections...');
  
  // Projects collection indexes
  const projectsCol = database.collection(COLLECTION_NAMES.PROJECTS);
  await projectsCol.createIndex({ projectId: 1 }, { unique: true });
  await projectsCol.createIndex({ status: 1 });
  await projectsCol.createIndex({ ownerId: 1 });
  await projectsCol.createIndex({ createdAt: -1 });
  
  // Tasks collection indexes - optimized for various query patterns
  const tasksCol = database.collection(COLLECTION_NAMES.TASKS);
  await tasksCol.createIndex({ taskId: 1 }, { unique: true });
  await tasksCol.createIndex({ projectId: 1, status: 1 });
  await tasksCol.createIndex({ ownerId: 1, ownerType: 1 });
  await tasksCol.createIndex({ status: 1, dueDate: 1 });
  await tasksCol.createIndex({ dueDate: 1 });
  await tasksCol.createIndex({ createdAt: -1 });
  
  // Vendors collection indexes
  const vendorsCol = database.collection(COLLECTION_NAMES.VENDORS);
  await vendorsCol.createIndex({ vendorId: 1 }, { unique: true });
  await vendorsCol.createIndex({ contactEmail: 1 }, { unique: true, sparse: true });
  await vendorsCol.createIndex({ status: 1 });
  
  // External employees collection indexes
  const externalCol = database.collection(COLLECTION_NAMES.EXTERNAL_EMPLOYEES);
  await externalCol.createIndex({ externalId: 1 }, { unique: true });
  await externalCol.createIndex({ email: 1 }, { unique: true, sparse: true });
  await externalCol.createIndex({ vendorId: 1 });
  
  // OneDrive connections
  const connectionsCol = database.collection(COLLECTION_NAMES.ONEDRIVE_CONNECTIONS);
  await connectionsCol.createIndex({ connectionId: 1 }, { unique: true });
  
  // OneDrive sync records
  const syncCol = database.collection(COLLECTION_NAMES.ONEDRIVE_SYNC_RECORDS);
  await syncCol.createIndex({ syncId: 1 }, { unique: true });
  await syncCol.createIndex({ connectionId: 1, oneDriveItemId: 1 });
  await syncCol.createIndex({ projectId: 1 });
  await syncCol.createIndex({ processingStatus: 1 });
  
  // Activity logs - with TTL for automatic cleanup (keep 1 year)
  const logsCol = database.collection(COLLECTION_NAMES.PROJECT_ACTIVITY_LOGS);
  await logsCol.createIndex({ logId: 1 }, { unique: true });
  await logsCol.createIndex({ entityType: 1, entityId: 1 });
  await logsCol.createIndex({ timestamp: -1 });
  await logsCol.createIndex({ actorId: 1 });
  
  console.log('✅ Project Tracker collections initialized');
};

// =============================================================================
// COLLECTION GETTERS
// =============================================================================

export const getProjectsCollection = (): Collection<Project> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.PROJECTS);
};

export const getTasksCollection = (): Collection<Task> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.TASKS);
};

export const getVendorsCollection = (): Collection<Vendor> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.VENDORS);
};

export const getExternalEmployeesCollection = (): Collection<ExternalEmployee> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.EXTERNAL_EMPLOYEES);
};

export const getOneDriveConnectionsCollection = (): Collection<OneDriveConnection> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.ONEDRIVE_CONNECTIONS);
};

export const getOneDriveSyncCollection = (): Collection<OneDriveSyncRecord> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.ONEDRIVE_SYNC_RECORDS);
};

export const getProjectActivityLogsCollection = (): Collection<ProjectActivityLog> => {
  if (!database) throw new Error('Project Tracker DB not initialized');
  return database.collection(COLLECTION_NAMES.PROJECT_ACTIVITY_LOGS);
};

// =============================================================================
// ACTIVITY LOGGING - Central audit trail
// =============================================================================

export const logProjectActivity = async (
  action: string,
  entityType: ProjectActivityLog['entityType'],
  entityId: string,
  actorId: string,
  actorName: string,
  actorType: ProjectActivityLog['actorType'],
  options?: {
    previousValue?: any;
    newValue?: any;
    description?: string;
    ipAddress?: string;
    userAgent?: string;
    projectId?: string; // For task events, link to parent project
  }
): Promise<void> => {
  const col = getProjectActivityLogsCollection();
  const logEntry: any = {
    logId: `LOG-${uuidv4()}`,
    timestamp: new Date(),
    action,
    entityType,
    entityId,
    actorId,
    actorName,
    actorType,
    ...options,
  };
  
  // If projectId is provided (e.g., for task events), store it at top level
  if (options?.projectId) {
    logEntry.projectId = options.projectId;
  }
  
  await col.insertOne(logEntry as ProjectActivityLog);
};

/**
 * Get activity logs with optional filters
 */
export const getActivityLogs = async (filters?: {
  projectId?: string;
  entityType?: ProjectActivityLog['entityType'];
  actorId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<ProjectActivityLog[]> => {
  const col = getProjectActivityLogsCollection();
  const query: any = {};
  
  if (filters?.projectId) {
    // Find logs for project and its tasks
    query.$or = [
      { entityId: filters.projectId, entityType: 'project' },
      { 'newValue.projectId': filters.projectId },
    ];
  }
  if (filters?.entityType) query.entityType = filters.entityType;
  if (filters?.actorId) query.actorId = filters.actorId;
  if (filters?.action) query.action = filters.action;
  if (filters?.startDate || filters?.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = filters.startDate;
    if (filters.endDate) query.timestamp.$lte = filters.endDate;
  }
  
  const cursor = col.find(query).sort({ timestamp: -1 });
  if (filters?.limit) cursor.limit(filters.limit);
  
  return await cursor.toArray();
};

/**
 * Get activity logs for a specific project (including task activity)
 */
export const getProjectActivityLogs = async (
  projectId: string,
  limit: number = 100
): Promise<ProjectActivityLog[]> => {
  const col = getProjectActivityLogsCollection();
  
  // Get all activity related to this project
  // Includes: direct project events, task events with projectId field, and legacy events
  return await col.find({
    $or: [
      { entityId: projectId },
      { projectId: projectId },
      { 'newValue.projectId': projectId },
    ]
  })
  .sort({ timestamp: -1 })
  .limit(limit)
  .toArray();
};

// =============================================================================
// PROJECT CRUD OPERATIONS
// =============================================================================

export const createProject = async (
  project: Omit<Project, '_id' | 'projectId' | 'createdAt' | 'updatedAt' | 'taskSummary'>,
  creatorId: string,
  creatorName: string
): Promise<Project> => {
  const col = getProjectsCollection();
  
  // Generate project ID
  const count = await col.countDocuments();
  const projectId = `PRJ-${String(count + 1).padStart(3, '0')}`;
  
  const newProject: Project = {
    ...project,
    projectId,
    taskSummary: { total: 0, completed: 0, inProgress: 0, blocked: 0, notStarted: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await col.insertOne(newProject as Project);
  
  // Log activity
  await logProjectActivity(
    'project.created',
    'project',
    projectId,
    creatorId,
    creatorName,
    'internal',
    { newValue: { name: project.name, status: project.status }, description: `Created project "${project.name}"` }
  );
  
  return newProject;
};

export const getProjectById = async (projectId: string): Promise<Project | null> => {
  const col = getProjectsCollection();
  return await col.findOne({ projectId });
};

export const getAllProjects = async (options?: {
  status?: ProjectStatus[];
  ownerId?: string;
  limit?: number;
  skip?: number;
}): Promise<Project[]> => {
  const col = getProjectsCollection();
  const query: any = {};
  
  if (options?.status?.length) query.status = { $in: options.status };
  if (options?.ownerId) query.ownerId = options.ownerId;
  
  let cursor = col.find(query).sort({ createdAt: -1 });
  if (options?.skip) cursor = cursor.skip(options.skip);
  if (options?.limit) cursor = cursor.limit(options.limit);
  
  return await cursor.toArray();
};

export const updateProject = async (
  projectId: string,
  updates: Partial<Omit<Project, '_id' | 'projectId' | 'createdAt'>>,
  updaterId: string,
  updaterName: string
): Promise<Project | null> => {
  const col = getProjectsCollection();
  
  const previous = await col.findOne({ projectId });
  
  const result = await col.findOneAndUpdate(
    { projectId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  
  if (result) {
    await logProjectActivity(
      'project.updated',
      'project',
      projectId,
      updaterId,
      updaterName,
      'internal',
      { previousValue: previous, newValue: updates, description: `Updated project "${previous?.name}"` }
    );
  }
  
  return result;
};

export const deleteProject = async (
  projectId: string,
  deleterId: string,
  deleterName: string
): Promise<boolean> => {
  const col = getProjectsCollection();
  const tasksCol = getTasksCollection();
  
  const project = await col.findOne({ projectId });
  if (!project) return false;
  
  // Delete all tasks in this project
  await tasksCol.deleteMany({ projectId });
  
  const result = await col.deleteOne({ projectId });
  
  if (result.deletedCount > 0) {
    await logProjectActivity(
      'project.deleted',
      'project',
      projectId,
      deleterId,
      deleterName,
      'internal',
      { previousValue: { name: project.name }, description: `Deleted project "${project.name}"` }
    );
  }
  
  return result.deletedCount > 0;
};

// =============================================================================
// TASK CRUD OPERATIONS
// =============================================================================

export const createTask = async (
  task: Omit<Task, '_id' | 'taskId' | 'createdAt' | 'updatedAt' | 'comments'>,
  creatorId: string,
  creatorName: string
): Promise<Task> => {
  const col = getTasksCollection();
  
  // Generate task ID
  const count = await col.countDocuments();
  const taskId = `TSK-${String(count + 1).padStart(4, '0')}`;
  
  const newTask: Task = {
    ...task,
    taskId,
    percentComplete: task.percentComplete || 0,
    comments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await col.insertOne(newTask as Task);
  
  // Update project task summary
  await updateProjectTaskSummary(task.projectId);
  
  // Log activity with projectId for easier querying
  await logProjectActivity(
    'task.created',
    'task',
    taskId,
    creatorId,
    creatorName,
    task.isAIGenerated ? 'system' : 'internal',
    { 
      newValue: { title: task.title, status: task.status, ownerName: task.ownerName }, 
      description: `Created task "${task.title}"`,
      projectId: task.projectId, // Link task event to project
    }
  );
  
  return newTask;
};

export const getTaskById = async (taskId: string): Promise<Task | null> => {
  const col = getTasksCollection();
  return await col.findOne({ taskId });
};

export const getTasksByProject = async (projectId: string, options?: {
  status?: TaskStatus[];
  ownerType?: OwnerType[];
}): Promise<Task[]> => {
  const col = getTasksCollection();
  const query: any = { projectId };
  
  if (options?.status?.length) query.status = { $in: options.status };
  if (options?.ownerType?.length) query.ownerType = { $in: options.ownerType };
  
  return await col.find(query).sort({ createdAt: -1 }).toArray();
};

export const getTasksWithFilters = async (filters: TaskFilterOptions): Promise<Task[]> => {
  const col = getTasksCollection();
  const query: any = {};
  
  if (filters.projectId) query.projectId = filters.projectId;
  if (filters.status?.length) query.status = { $in: filters.status };
  if (filters.ownerType?.length) query.ownerType = { $in: filters.ownerType };
  if (filters.ownerId) query.ownerId = filters.ownerId;
  if (filters.priority?.length) query.priority = { $in: filters.priority };
  
  if (filters.dueDateFrom || filters.dueDateTo) {
    query.dueDate = {};
    if (filters.dueDateFrom) query.dueDate.$gte = filters.dueDateFrom;
    if (filters.dueDateTo) query.dueDate.$lte = filters.dueDateTo;
  }
  
  if (filters.isOverdue) {
    query.dueDate = { $lt: new Date() };
    query.status = { $nin: ['completed', 'cancelled'] };
  }
  
  if (filters.isBlocked) {
    query.status = 'blocked';
  }
  
  if (filters.searchQuery) {
    query.$or = [
      { title: { $regex: filters.searchQuery, $options: 'i' } },
      { description: { $regex: filters.searchQuery, $options: 'i' } },
      { ownerName: { $regex: filters.searchQuery, $options: 'i' } },
    ];
  }
  
  return await col.find(query).sort({ dueDate: 1, priority: -1 }).toArray();
};

export const updateTask = async (
  taskId: string,
  updates: Partial<Omit<Task, '_id' | 'taskId' | 'createdAt' | 'projectId'>>,
  updaterId: string,
  updaterName: string,
  updaterType: OwnerType = 'internal'
): Promise<Task | null> => {
  const col = getTasksCollection();
  
  const previous = await col.findOne({ taskId });
  if (!previous) return null;
  
  const result = await col.findOneAndUpdate(
    { taskId },
    { 
      $set: { 
        ...updates, 
        lastUpdatedBy: updaterId,
        lastUpdatedByType: updaterType,
        updatedAt: new Date(),
        // Set completedDate if status changed to completed
        ...(updates.status === 'completed' && previous.status !== 'completed' 
          ? { completedDate: new Date() } 
          : {}),
      } 
    },
    { returnDocument: 'after' }
  );
  
  if (result) {
    // Update project summary if status changed
    if (updates.status && updates.status !== previous.status) {
      await updateProjectTaskSummary(previous.projectId);
    }
    
    await logProjectActivity(
      'task.updated',
      'task',
      taskId,
      updaterId,
      updaterName,
      updaterType,
      { 
        previousValue: { status: previous.status, percentComplete: previous.percentComplete },
        newValue: updates,
        description: `Updated task "${previous.title}"${updates.status ? ` - status: ${updates.status}` : ''}`,
        projectId: previous.projectId, // Link task event to project
      }
    );
  }
  
  return result;
};

export const addTaskComment = async (
  taskId: string,
  content: string,
  authorId: string,
  authorName: string,
  authorType: OwnerType,
  isSystemGenerated: boolean = false
): Promise<Task | null> => {
  const col = getTasksCollection();
  
  const comment = {
    id: uuidv4(),
    content,
    authorId,
    authorName,
    authorType,
    createdAt: new Date(),
    isSystemGenerated,
  };
  
  const result = await col.findOneAndUpdate(
    { taskId },
    { 
      $push: { comments: comment },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );
  
  if (result && !isSystemGenerated) {
    await logProjectActivity(
      'task.comment.added',
      'task',
      taskId,
      authorId,
      authorName,
      authorType,
      { newValue: { comment: content.substring(0, 100) }, description: `Added comment to task` }
    );
  }
  
  return result;
};

export const deleteTask = async (
  taskId: string,
  deleterId: string,
  deleterName: string
): Promise<boolean> => {
  const col = getTasksCollection();
  
  const task = await col.findOne({ taskId });
  if (!task) return false;
  
  const result = await col.deleteOne({ taskId });
  
  if (result.deletedCount > 0) {
    await updateProjectTaskSummary(task.projectId);
    
    await logProjectActivity(
      'task.deleted',
      'task',
      taskId,
      deleterId,
      deleterName,
      'internal',
      { previousValue: { title: task.title }, description: `Deleted task "${task.title}"` }
    );
  }
  
  return result.deletedCount > 0;
};

/**
 * Vendor/External portal task update - limited fields
 */
export const updateTaskFromPortal = async (
  taskId: string,
  update: VendorTaskUpdate,
  updaterId: string,
  updaterName: string,
  updaterType: OwnerType
): Promise<Task | null> => {
  const task = await getTaskById(taskId);
  if (!task) return null;
  
  // Verify the updater is assigned to this task
  if (task.ownerId !== updaterId && task.ownerType !== updaterType) {
    throw new Error('Not authorized to update this task');
  }
  
  const updates: Partial<Task> = {};
  
  if (update.percentComplete !== undefined) {
    updates.percentComplete = Math.max(0, Math.min(100, update.percentComplete));
  }
  
  if (update.status && ['not-started', 'in-progress', 'blocked', 'completed'].includes(update.status)) {
    updates.status = update.status;
    if (update.status === 'blocked' && update.blockerReason) {
      updates.blockerReason = update.blockerReason;
    }
  }
  
  const result = await updateTask(taskId, updates, updaterId, updaterName, updaterType);
  
  // Add comment if provided
  if (result && update.comment) {
    await addTaskComment(taskId, update.comment, updaterId, updaterName, updaterType);
  }
  
  return result;
};

// =============================================================================
// PROJECT SUMMARY COMPUTATION
// =============================================================================

export const updateProjectTaskSummary = async (projectId: string): Promise<void> => {
  const col = getProjectsCollection();
  const tasksCol = getTasksCollection();
  
  const tasks = await tasksCol.find({ projectId }).toArray();
  
  const summary = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    notStarted: tasks.filter(t => t.status === 'not-started').length,
  };
  
  await col.updateOne(
    { projectId },
    { $set: { taskSummary: summary, updatedAt: new Date() } }
  );
};

// =============================================================================
// VENDOR CRUD OPERATIONS
// =============================================================================

export const createVendor = async (
  vendor: Omit<Vendor, '_id' | 'vendorId' | 'createdAt' | 'updatedAt'>,
  creatorId: string
): Promise<Vendor> => {
  const col = getVendorsCollection();
  
  const count = await col.countDocuments();
  const vendorId = `VND-${String(count + 1).padStart(3, '0')}`;
  
  const newVendor: Vendor = {
    ...vendor,
    vendorId,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: creatorId,
  };
  
  await col.insertOne(newVendor as Vendor);
  
  await logProjectActivity(
    'vendor.created',
    'vendor',
    vendorId,
    creatorId,
    creatorId,
    'internal',
    { newValue: { name: vendor.name }, description: `Created vendor "${vendor.name}"` }
  );
  
  return newVendor;
};

export const getVendorById = async (vendorId: string): Promise<Vendor | null> => {
  const col = getVendorsCollection();
  return await col.findOne({ vendorId });
};

export const getVendorByEmail = async (email: string): Promise<Vendor | null> => {
  const col = getVendorsCollection();
  return await col.findOne({ contactEmail: email });
};

export const getAllVendors = async (status?: 'active' | 'inactive' | 'suspended'): Promise<Vendor[]> => {
  const col = getVendorsCollection();
  const query: any = {};
  if (status) query.status = status;
  return await col.find(query).sort({ name: 1 }).toArray();
};

export const updateVendor = async (
  vendorId: string,
  updates: Partial<Omit<Vendor, '_id' | 'vendorId' | 'createdAt'>>,
  updaterId: string
): Promise<Vendor | null> => {
  const col = getVendorsCollection();
  
  const result = await col.findOneAndUpdate(
    { vendorId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  
  if (result) {
    await logProjectActivity(
      'vendor.updated',
      'vendor',
      vendorId,
      updaterId,
      updaterId,
      'internal',
      { newValue: updates, description: `Updated vendor` }
    );
  }
  
  return result;
};

// =============================================================================
// EXTERNAL EMPLOYEE CRUD OPERATIONS
// =============================================================================

export const createExternalEmployee = async (
  employee: Omit<ExternalEmployee, '_id' | 'externalId' | 'createdAt' | 'updatedAt'>,
  creatorId: string
): Promise<ExternalEmployee> => {
  const col = getExternalEmployeesCollection();
  
  const count = await col.countDocuments();
  const externalId = `EXT-${String(count + 1).padStart(3, '0')}`;
  
  const newEmployee: ExternalEmployee = {
    ...employee,
    externalId,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: creatorId,
  };
  
  await col.insertOne(newEmployee as ExternalEmployee);
  
  await logProjectActivity(
    'external.created',
    'external',
    externalId,
    creatorId,
    creatorId,
    'internal',
    { newValue: { name: employee.name }, description: `Created external employee "${employee.name}"` }
  );
  
  return newEmployee;
};

export const getExternalEmployeeById = async (externalId: string): Promise<ExternalEmployee | null> => {
  const col = getExternalEmployeesCollection();
  return await col.findOne({ externalId });
};

export const getExternalEmployeeByEmail = async (email: string): Promise<ExternalEmployee | null> => {
  const col = getExternalEmployeesCollection();
  return await col.findOne({ email });
};

export const getAllExternalEmployees = async (): Promise<ExternalEmployee[]> => {
  const col = getExternalEmployeesCollection();
  return await col.find().sort({ name: 1 }).toArray();
};

// =============================================================================
// ONEDRIVE SYNC OPERATIONS
// =============================================================================

export const createOneDriveConnection = async (
  connection: Omit<OneDriveConnection, '_id' | 'connectionId' | 'createdAt' | 'updatedAt'>
): Promise<OneDriveConnection> => {
  const col = getOneDriveConnectionsCollection();
  
  const connectionId = `ODC-${uuidv4().substring(0, 8)}`;
  
  const newConnection: OneDriveConnection = {
    ...connection,
    connectionId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await col.insertOne(newConnection as OneDriveConnection);
  return newConnection;
};

export const getOneDriveConnection = async (connectionId: string): Promise<OneDriveConnection | null> => {
  const col = getOneDriveConnectionsCollection();
  return await col.findOne({ connectionId });
};

export const updateOneDriveConnection = async (
  connectionId: string,
  updates: Partial<OneDriveConnection>
): Promise<OneDriveConnection | null> => {
  const col = getOneDriveConnectionsCollection();
  return await col.findOneAndUpdate(
    { connectionId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
};

export const createSyncRecord = async (
  record: Omit<OneDriveSyncRecord, '_id' | 'syncId' | 'createdAt' | 'updatedAt'>
): Promise<OneDriveSyncRecord> => {
  const col = getOneDriveSyncCollection();
  
  const syncId = `SYNC-${uuidv4().substring(0, 8)}`;
  
  const newRecord: OneDriveSyncRecord = {
    ...record,
    syncId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await col.insertOne(newRecord as OneDriveSyncRecord);
  return newRecord;
};

export const getSyncRecordByItemId = async (
  connectionId: string,
  oneDriveItemId: string
): Promise<OneDriveSyncRecord | null> => {
  const col = getOneDriveSyncCollection();
  return await col.findOne({ connectionId, oneDriveItemId });
};

export const updateSyncRecord = async (
  syncId: string,
  updates: Partial<OneDriveSyncRecord>
): Promise<OneDriveSyncRecord | null> => {
  const col = getOneDriveSyncCollection();
  return await col.findOneAndUpdate(
    { syncId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
};

export const getPendingSyncRecords = async (): Promise<OneDriveSyncRecord[]> => {
  const col = getOneDriveSyncCollection();
  return await col.find({ processingStatus: 'pending' }).toArray();
};

// =============================================================================
// DASHBOARD STATISTICS
// =============================================================================

export const getDashboardStats = async (): Promise<ProjectDashboardStats> => {
  const projectsCol = getProjectsCollection();
  const tasksCol = getTasksCollection();
  
  const [projects, tasks] = await Promise.all([
    projectsCol.find().toArray(),
    tasksCol.find().toArray(),
  ]);
  
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const tasksByStatus: Record<TaskStatus, number> = {
    'not-started': 0,
    'in-progress': 0,
    'blocked': 0,
    'completed': 0,
    'cancelled': 0,
  };
  
  const tasksByOwnerType: Record<OwnerType, number> = {
    'internal': 0,
    'external': 0,
    'vendor': 0,
  };
  
  let overdueTasks = 0;
  let tasksCompletedThisWeek = 0;
  let totalCompletion = 0;
  
  const blockedTasks: Array<{ task: Task; daysPending: number }> = [];
  
  for (const task of tasks) {
    tasksByStatus[task.status]++;
    tasksByOwnerType[task.ownerType]++;
    totalCompletion += task.percentComplete;
    
    if (task.dueDate && new Date(task.dueDate) < now && 
        task.status !== 'completed' && task.status !== 'cancelled') {
      overdueTasks++;
    }
    
    if (task.completedDate && new Date(task.completedDate) >= oneWeekAgo) {
      tasksCompletedThisWeek++;
    }
    
    if (task.status === 'blocked') {
      const daysPending = Math.floor((now.getTime() - new Date(task.updatedAt).getTime()) / (24 * 60 * 60 * 1000));
      blockedTasks.push({ task, daysPending });
    }
  }
  
  // Sort blocked tasks by days pending and get top 5
  blockedTasks.sort((a, b) => b.daysPending - a.daysPending);
  const topBottlenecks = blockedTasks.slice(0, 5).map(({ task, daysPending }) => {
    const project = projects.find(p => p.projectId === task.projectId);
    return {
      taskId: task.taskId,
      taskTitle: task.title,
      projectName: project?.name || 'Unknown Project',
      owner: task.ownerName,
      daysPending,
    };
  });
  
  return {
    totalProjects: projects.length,
    activeProjects: projects.filter(p => p.status === 'active').length,
    totalTasks: tasks.length,
    tasksByStatus,
    tasksByOwnerType,
    overdueTasks,
    blockedTasks: tasksByStatus.blocked,
    tasksCompletedThisWeek,
    avgCompletionRate: tasks.length > 0 ? Math.round(totalCompletion / tasks.length) : 0,
    topBottlenecks,
  };
};

// =============================================================================
// TASKS BY OWNER (for "pending on whom" view)
// =============================================================================

export const getTasksGroupedByOwner = async (): Promise<Map<string, Task[]>> => {
  const tasksCol = getTasksCollection();
  const tasks = await tasksCol.find({
    status: { $in: ['not-started', 'in-progress', 'blocked'] }
  }).toArray();
  
  const grouped = new Map<string, Task[]>();
  
  for (const task of tasks) {
    const key = `${task.ownerType}:${task.ownerId}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(task);
  }
  
  return grouped;
};

/**
 * Get tasks assigned to a specific vendor or external user
 * Used for the vendor portal - limited view
 */
export const getTasksForPortalUser = async (
  userType: 'vendor' | 'external',
  userId: string
): Promise<Task[]> => {
  const col = getTasksCollection();
  return await col.find({
    ownerType: userType,
    ownerId: userId,
  }).sort({ dueDate: 1, priority: -1 }).toArray();
};

// =============================================================================
// EXPORT DEFAULT
// =============================================================================

export default {
  initializeProjectTrackerDb,
  // Collections
  getProjectsCollection,
  getTasksCollection,
  getVendorsCollection,
  getExternalEmployeesCollection,
  getOneDriveConnectionsCollection,
  getOneDriveSyncCollection,
  getProjectActivityLogsCollection,
  // Activity logging
  logProjectActivity,
  getActivityLogs,
  getProjectActivityLogs,
  // Projects
  createProject,
  getProjectById,
  getAllProjects,
  updateProject,
  deleteProject,
  updateProjectTaskSummary,
  // Tasks
  createTask,
  getTaskById,
  getTasksByProject,
  getTasksWithFilters,
  updateTask,
  addTaskComment,
  deleteTask,
  updateTaskFromPortal,
  // Vendors
  createVendor,
  getVendorById,
  getVendorByEmail,
  getAllVendors,
  updateVendor,
  // External employees
  createExternalEmployee,
  getExternalEmployeeById,
  getExternalEmployeeByEmail,
  getAllExternalEmployees,
  // OneDrive
  createOneDriveConnection,
  getOneDriveConnection,
  updateOneDriveConnection,
  createSyncRecord,
  getSyncRecordByItemId,
  updateSyncRecord,
  getPendingSyncRecords,
  // Dashboard
  getDashboardStats,
  getTasksGroupedByOwner,
  getTasksForPortalUser,
};
