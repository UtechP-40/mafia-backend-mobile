import mongoose from 'mongoose';
import { databaseOptimizer } from '../utils/databaseOptimization';

export const up = async (): Promise<void> => {
  console.log('Creating database indexes...');
  
  try {
    await databaseOptimizer.setupIndexes();
    console.log('✅ Database indexes created successfully');
  } catch (error) {
    console.error('❌ Failed to create database indexes:', error);
    throw error;
  }
};

export const down = async (): Promise<void> => {
  console.log('Dropping database indexes...');
  
  try {
    const collections = await mongoose.connection.db.collections();
    
    for (const collection of collections) {
      // Drop all indexes except _id
      const indexes = await collection.indexes();
      
      for (const index of indexes) {
        if (index.name !== '_id_') {
          await collection.dropIndex(index.name);
          console.log(`Dropped index: ${index.name} from ${collection.collectionName}`);
        }
      }
    }
    
    console.log('✅ Database indexes dropped successfully');
  } catch (error) {
    console.error('❌ Failed to drop database indexes:', error);
    throw error;
  }
};

export const description = 'Create optimized database indexes for better query performance';