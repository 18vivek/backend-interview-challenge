import axios from 'axios';
import {
  Task,
  SyncQueueItem,
  SyncResult,
  BatchSyncRequest,
  BatchSyncResponse,
} from '../types';
import { AppDatabase } from '../db/database';
import { TaskService } from './taskService';
import { v4 as uuidv4 } from 'uuid';

export class SyncService {
  private apiUrl: string;

  constructor(
    private db: AppDatabase,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api',
  ) {
    this.apiUrl = apiUrl;
  }

  async sync(): Promise<SyncResult> {
    // TODO: Main sync orchestration method
    // 1. Get all items from sync queue
    // 2. Group items by batch (use SYNC_BATCH_SIZE from env)
    // 3. Process each batch
    // 4. Handle success/failure for each item
    // 5. Update sync status in database
    // 6. Return sync result summary
    console.log('🔄 Starting sync...');

    const canConnect = await this.checkConnectivity();
    if (!canConnect) {
      console.log('❌ No internet. Sync aborted.');
      return {
        success: 0,
        synced_items: 0,
        failed_items: 0,
        errors: [
          {
            task_id: 'none',
            operation: 'connectivity',
            error: 'No internet connection',
            timestamp: new Date(),
          },
        ],
      };
    }

    const items = await this.getPendingQueueItems();
    if (items.length === 0) {
      console.log('✅ Nothing to sync.');
      return {
        success: 1,
        synced_items: 0,
        failed_items: 0,
        errors: [],
      };
    }

    const batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '10', 10);
    let synced = 0;
    let failed = 0;
    const errors: any[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      try {
        const result = await this.processBatch(batch);

        const successful = result.processed_items.filter(
          (item) => item.status === 'success',
        ).length;
        const failedBatch = result.processed_items.filter(
          (item) => item.status === 'error',
        );

        synced += successful;
        failed += failedBatch.length;

        failedBatch.forEach((f) => {
          errors.push({
            task_id: f.client_id,
            operation: 'sync',
            error: f.error || 'Unknown error',
            timestamp: new Date(),
          });
        });
      } catch (err) {
        console.error('❌ Batch failed:', err);
        failed += batch.length;
        for (const item of batch) {
          errors.push({
            task_id: item.task_id,
            operation: item.operation,
            error: (err as Error).message,
            timestamp: new Date(),
          });
          await this.handleSyncError(item, err as Error);
        }
      }
    }

    return {
      success: failed === 0 ? 1 : 0,
      synced_items: synced,
      failed_items: failed,
      errors,
    };
  }

  startAutoSync(intervalMs: number = 5 * 60 * 1000): void {
    console.log(
      `🕒 Auto Sync Worker started. Interval: ${intervalMs / 1000 / 60} min`,
    );

    const runSync = async () => {
      try {
        console.log(`\n[AutoSync] Checking connectivity...`);
        const online = await this.checkConnectivity();

        if (!online) {
          console.log(`🌐 Offline detected. Skipping sync.`);
          return;
        }

        console.log(`[AutoSync] Connected. Starting sync...`);
        const result = await this.sync();

        console.log(
          `[AutoSync] ✅ Sync completed: ${result.synced_items} synced, ${result.failed_items} failed`,
        );
      } catch (err) {
        console.error(`[AutoSync] ❌ Sync error:`, (err as Error).message);
      }
    };

    // Run immediately once, then repeat every interval
    runSync();
    setInterval(runSync, intervalMs);
  }

  async addToSyncQueue(
    taskId: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<Task>,
  ): Promise<void> {
    // TODO: Add operation to sync queue
    // 1. Create sync queue item
    // 2. Store serialized task data
    // 3. Insert into sync_queue table
    const id = uuidv4();
    const now = new Date();

    await this.db.run(
      `INSERT INTO sync_queue (
      id, task_id, operation, data, created_at, retry_count
    ) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, taskId, operation, JSON.stringify(data), now.toISOString(), 0],
    );

    console.log(
      ` Added to sync queue | Task: ${taskId} | Operation: ${operation}`,
    );
  }

  private async processBatch(
    items: SyncQueueItem[],
  ): Promise<BatchSyncResponse> {
    // TODO: Process a batch of sync items
    // 1. Prepare batch request
    // 2. Send to server
    // 3. Handle response
    // 4. Apply conflict resolution if needed
    console.log(`📦 Processing batch of ${items.length} items...`);

    const batchRequest: BatchSyncRequest = {
      items,
      client_timestamp: new Date(),
    };

    try {
      console.log(`🌐 Sending batch to ${this.apiUrl}/sync/batch ...`);

      // Simulate a delay (mock server)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // ✅ Strongly typed literal values ('success' as const)
      const processed_items: BatchSyncResponse['processed_items'] = items.map(
        (item) => ({
          client_id: item.id,
          server_id: item.task_id,
          status: 'success' as const, // 👈 this is the key fix
        }),
      );

      console.log(`✅ Batch synced successfully.`);

      for (const item of items) {
        await this.updateSyncStatus(item.task_id, 'synced');
        await this.markAsSynced(item.id);
      }

      return { processed_items };
    } catch (error) {
      console.error('❌ Failed to process batch:', error);

      const failedItems: BatchSyncResponse['processed_items'] = items.map(
        (item) => ({
          client_id: item.id,
          server_id: item.task_id,
          status: 'error' as const, // 👈 explicit literal again
          error: (error as Error).message,
        }),
      );

      for (const item of items) {
        await this.updateSyncStatus(item.task_id, 'error');
        await this.handleSyncError(item, error as Error);
      }

      return { processed_items: failedItems };
    }
  }
  private async resolveConflict(
    localTask: Task,
    serverTask: Task,
  ): Promise<Task> {
    // TODO: Implement last-write-wins conflict resolution
    // 1. Compare updated_at timestamps
    // 2. Return the more recent version
    // 3. Log conflict resolution decision
    const localUpdated = new Date(localTask.updated_at).getTime();
    const serverUpdated = new Date(serverTask.updated_at).getTime();

    // Compare timestamps — newer one wins
    let resolved: Task;

    if (localUpdated > serverUpdated) {
      resolved = { ...localTask };
      console.log(
        `🧩 Conflict resolved: CLIENT version wins (local newer) | Task ID: ${localTask.id}`,
      );
    } else if (serverUpdated > localUpdated) {
      resolved = { ...serverTask };
      console.log(
        `🧩 Conflict resolved: SERVER version wins (server newer) | Task ID: ${localTask.id}`,
      );
    } else {
      resolved = { ...serverTask }; // default to server if equal
      console.log(
        `🧩 Conflict resolved: Equal timestamps, defaulted to SERVER | Task ID: ${localTask.id}`,
      );
    }

    // Update local database with the resolved task version
    await this.db.run(
      `
    UPDATE tasks
    SET title = ?, 
        description = ?, 
        completed = ?, 
        updated_at = ?, 
        sync_status = 'synced', 
        server_id = ?, 
        last_synced_at = ?
    WHERE id = ?
    `,
      [
        resolved.title,
        resolved.description,
        resolved.completed ? 1 : 0,
        resolved.updated_at instanceof Date
          ? resolved.updated_at.toISOString()
          : resolved.updated_at,
        resolved.server_id ?? null,
        new Date().toISOString(),
        resolved.id,
      ],
    );

    console.log(
      `✅ Conflict resolved and local DB updated for task ${resolved.id}`,
    );
    return resolved;
  }

  private async updateSyncStatus(
    taskId: string,
    status: 'synced' | 'error',
    serverData?: Partial<Task>,
  ): Promise<void> {
    // TODO: Update task sync status
    // 1. Update sync_status field
    // 2. Update server_id if provided
    // 3. Update last_synced_at timestamp
    // 4. Remove from sync queue if successful
    try {
      const now = new Date().toISOString();

      // If serverData is available, use it (e.g., server_id, timestamps)
      const serverId = serverData?.server_id ?? null;

      await this.db.run(
        `
      UPDATE tasks
      SET sync_status = ?, 
          server_id = COALESCE(?, server_id), 
          last_synced_at = ?
      WHERE id = ?
      `,
        [status, serverId, now, taskId],
      );

      if (status === 'synced') {
        console.log(`✅ Task ${taskId} marked as synced`);
      } else {
        console.log(`⚠️ Task ${taskId} marked as error`);
      }

      // Optionally, remove from sync queue on success
      if (status === 'synced') {
        await this.db.run(`DELETE FROM sync_queue WHERE task_id = ?`, [taskId]);
      }
    } catch (error) {
      console.error(
        `❌ Failed to update sync status for task ${taskId}:`,
        error,
      );
    }
  }

  private async handleSyncError(
    item: SyncQueueItem,
    error: Error,
  ): Promise<void> {
    // TODO: Handle sync errors
    // 1. Increment retry count
    // 2. Store error message
    // 3. If retry count exceeds limit, mark as permanent failure
    const maxRetries = parseInt(process.env.SYNC_RETRY_ATTEMPTS || '3', 10);

    try {
      // Get current retry count
      const current = await this.db.get(
        `SELECT retry_count FROM sync_queue WHERE id = ?`,
        [item.id],
      );

      const retryCount = (current?.retry_count || 0) + 1;
      const isPermanentFailure = retryCount >= maxRetries;

      await this.db.run(
        `
      UPDATE sync_queue
      SET retry_count = ?, 
          error_message = ?, 
          status = ?
      WHERE id = ?
      `,
        [
          retryCount,
          error.message,
          isPermanentFailure ? 'failed' : 'pending',
          item.id,
        ],
      );

      console.log(
        isPermanentFailure
          ? `💀 Task ${item.task_id} failed permanently after ${retryCount} retries`
          : `⚠️ Task ${item.task_id} will retry later (${retryCount}/${maxRetries})`,
      );
    } catch (err) {
      console.error(
        `❌ Failed to update sync_queue retry info for ${item.task_id}:`,
        err,
      );
    }
  }

  async checkConnectivity(): Promise<boolean> {
    // TODO: Check if server is reachable
    // 1. Make a simple health check request
    // 2. Return true if successful, false otherwise
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getPendingQueueItems(): Promise<SyncQueueItem[]> {
    return await this.db.all(
      'SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at ASC',
      ['pending'],
    );
  }

  async markAsSynced(queueId: string): Promise<void> {
    await this.db.run(
      `UPDATE sync_queue SET status = ?, synced_at = ? WHERE id = ?`,
      ['synced', new Date().toISOString(), queueId],
    );
  }
}
