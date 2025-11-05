import { AppDatabase } from '../db/database';
import { Task } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class TaskService {
  constructor(private db: AppDatabase) {}

  async getAllTasks(): Promise<Task[]> {
    const tasks = await this.db.all(
      `SELECT * FROM tasks WHERE is_deleted = 0`,
    );
    return tasks;
  }

  async getTask(id: string): Promise<Task | null> {
    const task = await this.db.get(
      `SELECT * FROM tasks WHERE id = ? AND is_deleted = 0`,
      [id],
    );
    return task || null;
  }

  async createTask(data: Partial<Task>): Promise<Task> {
    const id = uuidv4();
    const now = new Date().toISOString();

    await this.db.run(
      `
      INSERT INTO tasks 
      (id, title, description, completed, created_at, updated_at, is_deleted, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        data.title,
        data.description || '',
        data.completed ? 1 : 0,
        now,
        now,
        0,
        'pending',
      ],
    );

    return this.getTask(id) as Promise<Task>;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existing = await this.getTask(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    await this.db.run(
      `
      UPDATE tasks 
      SET title = ?, description = ?, completed = ?, updated_at = ?, sync_status = 'pending'
      WHERE id = ?
      `,
      [
        updates.title ?? existing.title,
        updates.description ?? existing.description,
        updates.completed ? 1 : 0,
        now,
        id,
      ],
    );

    return this.getTask(id);
  }

  async deleteTask(id: string): Promise<boolean> {
    const existing = await this.getTask(id);
    if (!existing) return false;

    await this.db.run(
      `
      UPDATE tasks
      SET is_deleted = 1, sync_status = 'pending', updated_at = ?
      WHERE id = ?
      `,
      [new Date().toISOString(), id],
    );

    return true;
  }

  async markSynced(id: string, serverId?: string): Promise<void> {
    await this.db.run(
      `
      UPDATE tasks
      SET sync_status = 'synced', server_id = ?, last_synced_at = ?
      WHERE id = ?
      `,
      [serverId ?? null, new Date().toISOString(), id],
    );
  }
}
