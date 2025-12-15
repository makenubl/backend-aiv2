const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';

async function run() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const users = db.collection('users');
    
    // Remove superadmin user
    const deleteResult = await users.deleteOne({ username: 'superadmin' });
    console.log('Deleted superadmin user:', deleteResult.deletedCount);
    
    // Restore admin@pvara.gov.pk to admin role
    const updateResult = await users.updateOne(
      { username: 'admin@pvara.gov.pk' },
      { $set: { role: 'admin' } }
    );
    console.log('Restored admin@pvara.gov.pk to admin role:', updateResult.modifiedCount);
    
    // List all users
    const allUsers = await users.find({}).toArray();
    console.log('\nAll users:');
    allUsers.forEach(u => {
      console.log(`  - ${u.username} (${u.role})`);
    });
    
  } finally {
    await client.close();
    console.log('\nDone.');
  }
}

run().catch(console.error);
