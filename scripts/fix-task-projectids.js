/**
 * Script to fix tasks that have MongoDB ObjectId as projectId instead of PRJ-XXX format
 */

const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'pvara_ai_eval';

async function fixTaskProjectIds() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    
    // Get all projects
    const projects = await db.collection('projects').find({}).toArray();
    console.log(`Found ${projects.length} projects`);
    
    let totalFixed = 0;
    
    for (const proj of projects) {
      const mongoId = proj._id.toString();
      const properProjectId = proj.projectId;
      
      console.log(`\nProject: ${properProjectId} (${proj.name})`);
      console.log(`  MongoDB _id: ${mongoId}`);
      
      // Find tasks with MongoDB ObjectId as projectId
      const tasksWithWrongId = await db.collection('tasks').find({ projectId: mongoId }).toArray();
      
      if (tasksWithWrongId.length > 0) {
        console.log(`  Found ${tasksWithWrongId.length} tasks with wrong projectId`);
        
        // Update them
        const result = await db.collection('tasks').updateMany(
          { projectId: mongoId },
          { $set: { projectId: properProjectId } }
        );
        
        console.log(`  Fixed ${result.modifiedCount} tasks -> ${properProjectId}`);
        totalFixed += result.modifiedCount;
      } else {
        // Check how many tasks have correct projectId
        const correctTasks = await db.collection('tasks').countDocuments({ projectId: properProjectId });
        console.log(`  ${correctTasks} tasks already have correct projectId`);
      }
    }
    
    console.log(`\n✅ Migration complete! Fixed ${totalFixed} tasks total.`);
    
    // Verify
    console.log('\n--- Verification ---');
    const allTasks = await db.collection('tasks').find({}).toArray();
    console.log(`Total tasks: ${allTasks.length}`);
    
    const tasksByProject = {};
    allTasks.forEach(t => {
      tasksByProject[t.projectId] = (tasksByProject[t.projectId] || 0) + 1;
    });
    
    console.log('Tasks per project:');
    Object.entries(tasksByProject).forEach(([pid, count]) => {
      console.log(`  ${pid}: ${count} tasks`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

fixTaskProjectIds();
