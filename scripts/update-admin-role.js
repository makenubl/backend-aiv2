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
    
    // Update admin@pvara.gov.pk to super-admin
    const result = await users.updateOne(
      { username: 'admin@pvara.gov.pk' },
      { $set: { role: 'super-admin' } }
    );
    console.log('Updated admin@pvara.gov.pk to super-admin:', result.modifiedCount);
    
    // Also add a new superadmin user if it doesn't exist
    const existingSuperAdmin = await users.findOne({ username: 'superadmin' });
    if (!existingSuperAdmin) {
      await users.insertOne({
        username: 'superadmin',
        email: 'superadmin@pvara.gov.pk',
        password: 'super123',
        name: 'Super Administrator',
        role: 'super-admin',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('Created new superadmin user');
    } else {
      console.log('superadmin user already exists');
    }
    
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
