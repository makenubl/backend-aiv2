/**
 * Script to associate orphaned audit logs with their proper projectIds
 */

const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'pvara_ai_eval';

async function fixAuditLogs() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    
    // Get all projects for lookup
    const projects = await db.collection('projects').find({}).toArray();
    const mongoIdToProjectId = {};
    projects.forEach(p => {
      mongoIdToProjectId[p._id.toString()] = p.projectId;
    });
    
    console.log('Project ID mapping:');
    Object.entries(mongoIdToProjectId).forEach(([mongoId, projId]) => {
      console.log(`  ${mongoId} -> ${projId}`);
    });
    
    // Get tasks to map taskId -> projectId
    const tasks = await db.collection('tasks').find({}).toArray();
    const taskToProject = {};
    tasks.forEach(t => {
      taskToProject[t.taskId] = t.projectId;
    });
    
    // Find all task.* audit logs
    const taskLogs = await db.collection('project_activity_logs')
      .find({ entityType: 'task' })
      .toArray();
    
    console.log(`\nFound ${taskLogs.length} task audit logs`);
    
    let updated = 0;
    for (const log of taskLogs) {
      const taskId = log.entityId; // e.g., TSK-0020
      const projectId = taskToProject[taskId];
      
      if (projectId && !log.projectId) {
        await db.collection('project_activity_logs').updateOne(
          { _id: log._id },
          { $set: { projectId: projectId } }
        );
        console.log(`  Added projectId ${projectId} to log for ${taskId}`);
        updated++;
      }
    }
    
    // Fix project.finalized logs that have MongoDB ObjectId as entityId
    const projectLogs = await db.collection('project_activity_logs')
      .find({ action: 'project.finalized' })
      .toArray();
    
    console.log(`\nFound ${projectLogs.length} project.finalized logs`);
    
    for (const log of projectLogs) {
      const properProjectId = mongoIdToProjectId[log.entityId];
      if (properProjectId) {
        await db.collection('project_activity_logs').updateOne(
          { _id: log._id },
          { $set: { entityId: properProjectId, projectId: properProjectId } }
        );
        console.log(`  Fixed entityId ${log.entityId} -> ${properProjectId}`);
        updated++;
      }
    }
    
    console.log(`\n✅ Fixed ${updated} audit log entries!`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

fixAuditLogs();
