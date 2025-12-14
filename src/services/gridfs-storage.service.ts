import { MongoClient, Db, GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'stream';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';

let mongoClient: MongoClient;
let database: Db;
let bucket: GridFSBucket;

// Folder metadata stored in a collection
const FOLDERS_COLLECTION = 'storage_folders';
const FILES_COLLECTION = 'storage_files_meta';

interface FolderMetadata {
  _id?: ObjectId;
  name: string;
  safeName: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  applicationJson?: {
    id: string;
    companyName: string;
    submittedBy: string;
    submitterEmail: string;
    applicationDate: string;
    documents: string[];
  };
}

interface FileMetadata {
  _id?: ObjectId;
  folderName: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  gridfsId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: string;
}

export const initGridFS = async (): Promise<void> => {
  if (bucket) return; // Already initialized
  
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    database = mongoClient.db(DB_NAME);
    bucket = new GridFSBucket(database, { bucketName: 'documents' });
    
    // Create indexes
    const foldersCollection = database.collection(FOLDERS_COLLECTION);
    await foldersCollection.createIndex({ safeName: 1 }, { unique: true });
    
    const filesCollection = database.collection(FILES_COLLECTION);
    await filesCollection.createIndex({ folderName: 1, fileName: 1 }, { unique: true });
    await filesCollection.createIndex({ folderName: 1 });
    
    console.log('✅ GridFS storage initialized');
  } catch (error) {
    console.error('❌ Failed to initialize GridFS:', error);
    throw error;
  }
};

export const getGridFSBucket = (): GridFSBucket => {
  if (!bucket) {
    throw new Error('GridFS not initialized. Call initGridFS first.');
  }
  return bucket;
};

// Check if running on Vercel (read-only filesystem)
export const isServerless = (): boolean => {
  return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
};

// ==================== FOLDER OPERATIONS ====================

export const createFolder = async (name: string, userEmail?: string): Promise<FolderMetadata> => {
  await initGridFS();
  const collection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
  
  // Check if folder exists
  const existing = await collection.findOne({ safeName });
  if (existing) {
    throw new Error('Folder already exists');
  }
  
  const folder: FolderMetadata = {
    name,
    safeName,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: userEmail,
    applicationJson: {
      id: safeName,
      companyName: '',
      submittedBy: '',
      submitterEmail: '',
      applicationDate: new Date().toISOString(),
      documents: [],
    },
  };
  
  await collection.insertOne(folder);
  return folder;
};

export const listFolders = async (): Promise<FolderMetadata[]> => {
  await initGridFS();
  const collection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  return await collection.find({}).sort({ createdAt: -1 }).toArray();
};

export const getFolder = async (safeName: string): Promise<FolderMetadata | null> => {
  await initGridFS();
  const collection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  return await collection.findOne({ safeName });
};

export const deleteFolder = async (safeName: string): Promise<boolean> => {
  await initGridFS();
  
  // Delete all files in the folder first
  const filesCollection = database.collection<FileMetadata>(FILES_COLLECTION);
  const files = await filesCollection.find({ folderName: safeName }).toArray();
  
  for (const file of files) {
    try {
      await bucket.delete(file.gridfsId);
    } catch (e) {
      console.warn(`Could not delete GridFS file ${file.gridfsId}:`, e);
    }
  }
  
  await filesCollection.deleteMany({ folderName: safeName });
  
  // Delete the folder metadata
  const foldersCollection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  const result = await foldersCollection.deleteOne({ safeName });
  
  return result.deletedCount > 0;
};

// ==================== FILE OPERATIONS ====================

export const uploadFile = async (
  folderName: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
  userEmail?: string
): Promise<FileMetadata> => {
  await initGridFS();
  
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');
  
  // Check if folder exists
  const folder = await getFolder(safeFolderName);
  if (!folder) {
    throw new Error('Folder not found');
  }
  
  const filesCollection = database.collection<FileMetadata>(FILES_COLLECTION);
  
  // Check if file already exists and delete it
  const existing = await filesCollection.findOne({ folderName: safeFolderName, fileName: safeFileName });
  if (existing) {
    try {
      await bucket.delete(existing.gridfsId);
    } catch (e) {
      console.warn('Could not delete existing GridFS file:', e);
    }
    await filesCollection.deleteOne({ _id: existing._id });
  }
  
  // Upload to GridFS
  const readable = Readable.from(buffer);
  const uploadStream = bucket.openUploadStream(safeFileName, {
    metadata: {
      folderName: safeFolderName,
      mimeType,
      uploadedBy: userEmail,
    },
  });
  
  await new Promise<void>((resolve, reject) => {
    readable.pipe(uploadStream)
      .on('error', reject)
      .on('finish', resolve);
  });
  
  const fileMetadata: FileMetadata = {
    folderName: safeFolderName,
    fileName: safeFileName,
    originalName: fileName,
    mimeType,
    size: buffer.length,
    gridfsId: uploadStream.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadedBy: userEmail,
  };
  
  await filesCollection.insertOne(fileMetadata);
  
  // Update folder's documents list
  const foldersCollection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  await foldersCollection.updateOne(
    { safeName: safeFolderName },
    { 
      $addToSet: { 'applicationJson.documents': safeFileName },
      $set: { updatedAt: new Date() }
    }
  );
  
  return fileMetadata;
};

export const listFiles = async (folderName: string): Promise<FileMetadata[]> => {
  await initGridFS();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const collection = database.collection<FileMetadata>(FILES_COLLECTION);
  return await collection.find({ folderName: safeFolderName }).sort({ createdAt: -1 }).toArray();
};

export const getFile = async (folderName: string, fileName: string): Promise<{ metadata: FileMetadata; buffer: Buffer } | null> => {
  await initGridFS();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');
  
  const collection = database.collection<FileMetadata>(FILES_COLLECTION);
  const metadata = await collection.findOne({ folderName: safeFolderName, fileName: safeFileName });
  
  if (!metadata) {
    return null;
  }
  
  // Download from GridFS
  const downloadStream = bucket.openDownloadStream(metadata.gridfsId);
  const chunks: Buffer[] = [];
  
  await new Promise<void>((resolve, reject) => {
    downloadStream
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  
  return {
    metadata,
    buffer: Buffer.concat(chunks),
  };
};

export const getFileBuffer = async (folderName: string, fileName: string): Promise<Buffer | null> => {
  const result = await getFile(folderName, fileName);
  return result?.buffer || null;
};

export const deleteFile = async (folderName: string, fileName: string): Promise<boolean> => {
  await initGridFS();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');
  
  const collection = database.collection<FileMetadata>(FILES_COLLECTION);
  const file = await collection.findOne({ folderName: safeFolderName, fileName: safeFileName });
  
  if (!file) {
    return false;
  }
  
  // Delete from GridFS
  try {
    await bucket.delete(file.gridfsId);
  } catch (e) {
    console.warn('Could not delete GridFS file:', e);
  }
  
  // Delete metadata
  await collection.deleteOne({ _id: file._id });
  
  // Update folder's documents list
  const foldersCollection = database.collection<FolderMetadata>(FOLDERS_COLLECTION);
  await foldersCollection.updateOne(
    { safeName: safeFolderName },
    { 
      $pull: { 'applicationJson.documents': safeFileName } as any,
      $set: { updatedAt: new Date() }
    }
  );
  
  return true;
};

// ==================== ACTIVITY LOG (in MongoDB) ====================

const ACTIVITIES_COLLECTION = 'storage_activities';

interface ActivityLog {
  _id?: ObjectId;
  id: string;
  userEmail: string;
  userRole: string;
  action: string;
  folder?: string;
  meta?: Record<string, any>;
  timestamp: string;
}

export const appendActivityLog = async (activity: Omit<ActivityLog, '_id'>): Promise<void> => {
  await initGridFS();
  const collection = database.collection<ActivityLog>(ACTIVITIES_COLLECTION);
  await collection.insertOne(activity);
};

export const getActivityLogs = async (limit = 100): Promise<ActivityLog[]> => {
  await initGridFS();
  const collection = database.collection<ActivityLog>(ACTIVITIES_COLLECTION);
  return await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
};
