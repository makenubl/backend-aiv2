/**
 * Script to update project task summaries after fixing projectIds
 */

const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'pvara_ai_eval';

async function updateProjectTaskSummaries() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    
    // Get all projects
    const projects = await db.collection('projects').find({}).toArray();
    console.log(`Found ${projects.length} projects to update\n`);
    
    for (const proj of projects) {
      const projectId = proj.projectId;
      
      // Count tasks by status
      const tasks = await db.collection('tasks').find({ projectId }).toArray();
      
      const summary = {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        notStarted: tasks.filter(t => t.status === 'not-started').length,
      };
      
      // Update project
      await db.collection('projects').updateOne(
        { projectId },
        { $set: { taskSummary: summary } }
      );
      
      console.log(`${projectId} (${proj.name}): ${summary.total} tasks`);
      console.log(`  - Not Started: ${summary.notStarted}`);
      console.log(`  - In Progress: ${summary.inProgress}`);
      console.log(`  - Completed: ${summary.completed}`);
      console.log(`  - Blocked: ${summary.blocked}`);
    }
    
    console.log('\n✅ All project summaries updated!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

updateProjectTaskSummaries();
