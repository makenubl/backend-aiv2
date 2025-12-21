import { 
  S3Client, 
  GetObjectCommand, 
  DeleteObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { Readable } from 'stream';

// Environment variables
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'pvara-documents';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';

// S3 Client
let s3Client: S3Client;

// MongoDB
let mongoClient: MongoClient;
let database: Db;

// Collections
const FOLDERS_COLLECTION = 's3_storage_folders';
const FILES_COLLECTION = 's3_storage_files';
const ACTIVITIES_COLLECTION = 's3_storage_activities';

// Interfaces
export interface S3FolderMetadata {
  _id?: ObjectId;
  name: string;
  safeName: string;
  s3Prefix: string;
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

export interface S3FileMetadata {
  _id?: ObjectId;
  folderName: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  s3Url: string;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: string;
  extractedText?: string;
}

export interface S3ActivityLog {
  _id?: ObjectId;
  id: string;
  userEmail: string;
  userRole: string;
  action: string;
  folder?: string;
  fileName?: string;
  meta?: Record<string, any>;
  timestamp: string;
}

// Initialize S3 and MongoDB
export const initS3Storage = async (): Promise<void> => {
  if (s3Client && database) return;

  try {
    // Initialize S3 Client
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });

    // Initialize MongoDB
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    database = mongoClient.db(DB_NAME);

    // Create indexes
    const foldersCollection = database.collection(FOLDERS_COLLECTION);
    await foldersCollection.createIndex({ safeName: 1 }, { unique: true });

    const filesCollection = database.collection(FILES_COLLECTION);
    await filesCollection.createIndex({ folderName: 1, fileName: 1 }, { unique: true });
    await filesCollection.createIndex({ folderName: 1 });
    await filesCollection.createIndex({ s3Key: 1 }, { unique: true });

    console.log('✅ S3 Storage service initialized');
    console.log(`   Bucket: ${S3_BUCKET_NAME}`);
    console.log(`   Region: ${AWS_REGION}`);
  } catch (error) {
    console.error('❌ Failed to initialize S3 Storage:', error);
    throw error;
  }
};

export const isS3Configured = (): boolean => {
  return !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && S3_BUCKET_NAME);
};

export const getS3Client = (): S3Client => {
  if (!s3Client) {
    throw new Error('S3 not initialized. Call initS3Storage first.');
  }
  return s3Client;
};

// ==================== FOLDER OPERATIONS ====================

export const createFolder = async (name: string, userEmail?: string): Promise<S3FolderMetadata> => {
  await initS3Storage();
  const collection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);

  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
  const s3Prefix = `applications/${safeName}/`;

  // Check if folder exists in MongoDB
  const existing = await collection.findOne({ safeName });
  if (existing) {
    throw new Error('Folder already exists');
  }

  const folder: S3FolderMetadata = {
    name,
    safeName,
    s3Prefix,
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

export const listFolders = async (): Promise<S3FolderMetadata[]> => {
  await initS3Storage();
  const collection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
  return await collection.find({}).sort({ createdAt: -1 }).toArray();
};

export const getFolder = async (safeName: string): Promise<S3FolderMetadata | null> => {
  await initS3Storage();
  const collection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
  return await collection.findOne({ safeName });
};

export const updateFolderApplicationJson = async (
  safeName: string, 
  applicationJson: Partial<S3FolderMetadata['applicationJson']>
): Promise<boolean> => {
  await initS3Storage();
  const collection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
  
  const updateFields: Record<string, any> = { updatedAt: new Date() };
  if (applicationJson) {
    for (const [key, value] of Object.entries(applicationJson)) {
      updateFields[`applicationJson.${key}`] = value;
    }
  }
  
  const result = await collection.updateOne(
    { safeName },
    { $set: updateFields }
  );
  
  return result.modifiedCount > 0;
};

export const deleteFolder = async (safeName: string): Promise<boolean> => {
  await initS3Storage();

  // Delete all files from S3 first
  const filesCollection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  const files = await filesCollection.find({ folderName: safeName }).toArray();

  for (const file of files) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: file.s3Key,
      }));
    } catch (e) {
      console.warn(`Could not delete S3 file ${file.s3Key}:`, e);
    }
  }

  // Delete file metadata from MongoDB
  await filesCollection.deleteMany({ folderName: safeName });

  // Delete folder metadata from MongoDB
  const foldersCollection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
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
): Promise<S3FileMetadata> => {
  await initS3Storage();

  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');
  const s3Key = `applications/${safeFolderName}/documents/${safeFileName}`;

  // Check if folder exists
  const folder = await getFolder(safeFolderName);
  if (!folder) {
    throw new Error('Folder not found');
  }

  const filesCollection = database.collection<S3FileMetadata>(FILES_COLLECTION);

  // Check if file already exists and delete from S3
  const existing = await filesCollection.findOne({ folderName: safeFolderName, fileName: safeFileName });
  if (existing) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: existing.s3Key,
      }));
    } catch (e) {
      console.warn('Could not delete existing S3 file:', e);
    }
    await filesCollection.deleteOne({ _id: existing._id });
  }

  // Upload to S3
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'folder-name': safeFolderName,
        'original-name': fileName,
        'uploaded-by': userEmail || 'unknown',
      },
    },
  });

  await upload.done();

  // Generate S3 URL
  const s3Url = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;

  // Save metadata to MongoDB
  const fileMetadata: S3FileMetadata = {
    folderName: safeFolderName,
    fileName: safeFileName,
    originalName: fileName,
    mimeType,
    size: buffer.length,
    s3Key,
    s3Bucket: S3_BUCKET_NAME,
    s3Url,
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadedBy: userEmail,
  };

  await filesCollection.insertOne(fileMetadata);

  // Update folder's documents list
  const foldersCollection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
  await foldersCollection.updateOne(
    { safeName: safeFolderName },
    {
      $addToSet: { 'applicationJson.documents': safeFileName },
      $set: { updatedAt: new Date() }
    }
  );

  console.log(`✅ File uploaded to S3: ${s3Key} (${buffer.length} bytes)`);
  return fileMetadata;
};

export const listFiles = async (folderName: string): Promise<S3FileMetadata[]> => {
  await initS3Storage();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const collection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  return await collection.find({ folderName: safeFolderName }).sort({ createdAt: -1 }).toArray();
};

export const getFile = async (
  folderName: string, 
  fileName: string
): Promise<{ metadata: S3FileMetadata; buffer: Buffer } | null> => {
  await initS3Storage();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');

  const collection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  const metadata = await collection.findOne({ folderName: safeFolderName, fileName: safeFileName });

  if (!metadata) {
    return null;
  }

  // Download from S3
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: metadata.s3Key,
    }));

    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;

    await new Promise<void>((resolve, reject) => {
      stream
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('error', reject)
        .on('end', resolve);
    });

    return {
      metadata,
      buffer: Buffer.concat(chunks),
    };
  } catch (error) {
    console.error(`Error downloading file from S3: ${metadata.s3Key}`, error);
    return null;
  }
};

export const getFileBuffer = async (folderName: string, fileName: string): Promise<Buffer | null> => {
  const result = await getFile(folderName, fileName);
  return result?.buffer || null;
};

export const getFileMetadata = async (
  folderName: string, 
  fileName: string
): Promise<S3FileMetadata | null> => {
  await initS3Storage();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');

  const collection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  return await collection.findOne({ folderName: safeFolderName, fileName: safeFileName });
};

export const deleteFile = async (folderName: string, fileName: string): Promise<boolean> => {
  await initS3Storage();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');

  const collection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  const file = await collection.findOne({ folderName: safeFolderName, fileName: safeFileName });

  if (!file) {
    return false;
  }

  // Delete from S3
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: file.s3Key,
    }));
    console.log(`✅ File deleted from S3: ${file.s3Key}`);
  } catch (e) {
    console.warn('Could not delete S3 file:', e);
  }

  // Delete metadata from MongoDB
  await collection.deleteOne({ _id: file._id });

  // Update folder's documents list
  const foldersCollection = database.collection<S3FolderMetadata>(FOLDERS_COLLECTION);
  await foldersCollection.updateOne(
    { safeName: safeFolderName },
    {
      $pull: { 'applicationJson.documents': safeFileName } as any,
      $set: { updatedAt: new Date() }
    }
  );

  return true;
};

// Update file's extracted text in metadata
export const updateFileExtractedText = async (
  folderName: string,
  fileName: string,
  extractedText: string
): Promise<boolean> => {
  await initS3Storage();
  const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');

  const collection = database.collection<S3FileMetadata>(FILES_COLLECTION);
  const result = await collection.updateOne(
    { folderName: safeFolderName, fileName: safeFileName },
    { $set: { extractedText, updatedAt: new Date() } }
  );

  return result.modifiedCount > 0;
};

// ==================== ACTIVITY LOG ====================

export const appendActivityLog = async (activity: Omit<S3ActivityLog, '_id'>): Promise<void> => {
  await initS3Storage();
  const collection = database.collection<S3ActivityLog>(ACTIVITIES_COLLECTION);
  await collection.insertOne(activity);
};

export const getActivityLogs = async (limit = 100): Promise<S3ActivityLog[]> => {
  await initS3Storage();
  const collection = database.collection<S3ActivityLog>(ACTIVITIES_COLLECTION);
  return await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
};

// ==================== UTILITY FUNCTIONS ====================

export const getSignedUrl = async (s3Key: string, _expiresIn = 3600): Promise<string> => {
  // For now, return the public URL. In production, use getSignedUrl from @aws-sdk/s3-request-presigner
  return `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;
};

export const checkS3Connection = async (): Promise<boolean> => {
  try {
    await initS3Storage();
    // Try to list objects to verify connection
    await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      MaxKeys: 1,
    }));
    return true;
  } catch (error) {
    console.error('S3 connection check failed:', error);
    return false;
  }
};

/**
 * Direct upload to S3 - for project tracker wizard
 * This bypasses the folder system for temporary wizard uploads
 */
export const uploadFileDirect = async (
  buffer: Buffer,
  s3Key: string,
  mimeType: string,
  originalName: string,
  userEmail?: string
): Promise<{ s3Key: string; s3Url: string; size: number }> => {
  await initS3Storage();

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'original-name': originalName,
        'uploaded-by': userEmail || 'unknown',
      },
    },
  });

  await upload.done();

  const s3Url = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;

  return {
    s3Key,
    s3Url,
    size: buffer.length,
  };
};

/**
 * Delete file from S3 directly by key - for project tracker wizard
 */
export const deleteFileDirect = async (s3Key: string): Promise<boolean> => {
  await initS3Storage();

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
    }));
    console.log(`✅ File deleted from S3: ${s3Key}`);
    return true;
  } catch (e) {
    console.warn('Could not delete S3 file:', e);
    return false;
  }
};