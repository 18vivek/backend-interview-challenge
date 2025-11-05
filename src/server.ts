import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AppDatabase } from './db/database';
import { createTaskRouter } from './routes/tasks';
import { createSyncRouter } from './routes/sync';
import { errorHandler } from './middleware/errorHandler';
import { TaskService } from './services/taskService';
import { SyncService } from './services/syncService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
const db = new AppDatabase(process.env.DATABASE_URL || './data/tasks.sqlite3');

// Routes
app.use('/api/tasks', createTaskRouter(db));
app.use('/api', createSyncRouter(db));

// Error handling
app.use(errorHandler);

// Start server
async function start() {
  try {
    await db.initialize();
    console.log('Database initialized');

    // Initialize services
    const taskService = new TaskService(db);
    const syncService = new SyncService(db, taskService);

    // 🕒 Start background auto-sync (every 5 minutes)
    const interval = parseInt(
      process.env.AUTO_SYNC_INTERVAL_MS || '300000',
      10,
    );
    syncService.startAutoSync(interval);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await db.close();
  process.exit(0);
});
