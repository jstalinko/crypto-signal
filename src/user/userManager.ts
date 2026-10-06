import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'blocked';
export type UserRole = 'admin' | 'user';

export interface BotUserProfile {
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface BotUser {
  id: string; // Telegram Chat ID as string
  username?: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  lastActiveAt?: string;
}

export interface UsersDatabase {
  version: number;
  updatedAt: string;
  users: Record<string, BotUser>;
}

export class UserManager {
  private filePath: string;
  private adminChatId: string;
  private users: Map<string, BotUser> = new Map();

  constructor(adminChatId: string, filePath?: string) {
    this.adminChatId = adminChatId.trim();
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'users.json');
    this.load();
  }

  /**
   * Load users database from JSON file
   */
  public load(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        this.users = new Map();
        // Automatically ensure admin user exists
        if (this.adminChatId) {
          const now = new Date().toISOString();
          const adminUser: BotUser = {
            id: this.adminChatId,
            role: 'admin',
            status: 'approved',
            createdAt: now,
            updatedAt: now,
            approvedAt: now,
            lastActiveAt: now
          };
          this.users.set(this.adminChatId, adminUser);
        }
        this.save();
        return;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const db: UsersDatabase = JSON.parse(raw);
      this.users = new Map();

      if (db.users && typeof db.users === 'object') {
        for (const [id, user] of Object.entries(db.users)) {
          this.users.set(id, user);
        }
      }

      // Always ensure the configured adminChatId has admin role & approved status
      if (this.adminChatId) {
        const existingAdmin = this.users.get(this.adminChatId);
        const now = new Date().toISOString();
        if (!existingAdmin) {
          this.users.set(this.adminChatId, {
            id: this.adminChatId,
            role: 'admin',
            status: 'approved',
            createdAt: now,
            updatedAt: now,
            approvedAt: now,
            lastActiveAt: now
          });
          this.save();
        } else if (existingAdmin.role !== 'admin' || existingAdmin.status !== 'approved') {
          existingAdmin.role = 'admin';
          existingAdmin.status = 'approved';
          existingAdmin.updatedAt = now;
          this.save();
        }
      }

      logger.info(`Loaded ${this.users.size} user(s) from ${this.filePath}`);
    } catch (err) {
      logger.error(`Failed to load users database from ${this.filePath}: ${(err as Error).message}`);
      this.users = new Map();
    }
  }

  /**
   * Persist users database to disk atomically
   */
  public save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const usersObj: Record<string, BotUser> = {};
      for (const [id, user] of this.users.entries()) {
        usersObj[id] = user;
      }

      const db: UsersDatabase = {
        version: 1,
        updatedAt: new Date().toISOString(),
        users: usersObj
      };

      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      logger.error(`Failed to save users database to ${this.filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Check if a chatId belongs to the admin
   */
  public isAdmin(chatId: string): boolean {
    if (!chatId) return false;
    const cleanId = chatId.toString().trim();
    if (cleanId === this.adminChatId) return true;
    const user = this.users.get(cleanId);
    return user?.role === 'admin';
  }

  /**
   * Check if user is approved
   */
  public isApproved(chatId: string): boolean {
    if (!chatId) return false;
    const cleanId = chatId.toString().trim();
    if (cleanId === this.adminChatId) return true;
    const user = this.users.get(cleanId);
    return user?.status === 'approved';
  }

  /**
   * Get user by ID
   */
  public getUser(chatId: string): BotUser | undefined {
    return this.users.get(chatId.toString().trim());
  }

  /**
   * Register a new user or update an existing user's profile info
   */
  public registerOrUpdate(
    chatId: string,
    profile: BotUserProfile
  ): { user: BotUser; isNew: boolean } {
    const cleanId = chatId.toString().trim();
    const now = new Date().toISOString();
    const existing = this.users.get(cleanId);

    if (existing) {
      let changed = false;

      if (profile.username !== undefined && profile.username !== existing.username) {
        existing.username = profile.username;
        changed = true;
      }
      if (profile.firstName !== undefined && profile.firstName !== existing.firstName) {
        existing.firstName = profile.firstName;
        changed = true;
      }
      if (profile.lastName !== undefined && profile.lastName !== existing.lastName) {
        existing.lastName = profile.lastName;
        changed = true;
      }

      existing.lastActiveAt = now;
      if (cleanId === this.adminChatId) {
        existing.role = 'admin';
        existing.status = 'approved';
      }

      if (changed) {
        existing.updatedAt = now;
      }

      this.save();
      return { user: existing, isNew: false };
    }

    // New user
    const isAdmin = cleanId === this.adminChatId;
    const newUser: BotUser = {
      id: cleanId,
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'approved' : 'pending',
      createdAt: now,
      updatedAt: now,
      approvedAt: isAdmin ? now : undefined,
      lastActiveAt: now
    };

    this.users.set(cleanId, newUser);
    this.save();
    logger.info(`Registered user ${cleanId} (@${profile.username || 'unknown'}) with status: ${newUser.status}`);

    return { user: newUser, isNew: !isAdmin };
  }

  /**
   * Approve a user
   */
  public approveUser(chatId: string): BotUser | null {
    const cleanId = chatId.toString().trim();
    const user = this.users.get(cleanId);
    if (!user) return null;

    const now = new Date().toISOString();
    user.status = 'approved';
    user.approvedAt = now;
    user.updatedAt = now;
    this.save();
    logger.info(`User ${cleanId} approved`);
    return user;
  }

  /**
   * Reject a user
   */
  public rejectUser(chatId: string): BotUser | null {
    const cleanId = chatId.toString().trim();
    const user = this.users.get(cleanId);
    if (!user) return null;

    const now = new Date().toISOString();
    user.status = 'rejected';
    user.rejectedAt = now;
    user.updatedAt = now;
    this.save();
    logger.info(`User ${cleanId} rejected`);
    return user;
  }

  /**
   * Block a user (e.g., when bot is blocked by user)
   */
  public blockUser(chatId: string): BotUser | null {
    const cleanId = chatId.toString().trim();
    const user = this.users.get(cleanId);
    if (!user) return null;

    user.status = 'blocked';
    user.updatedAt = new Date().toISOString();
    this.save();
    logger.info(`User ${cleanId} marked as blocked`);
    return user;
  }

  /**
   * Delete a user from database
   */
  public deleteUser(chatId: string): boolean {
    const cleanId = chatId.toString().trim();
    if (cleanId === this.adminChatId) {
      logger.warn(`Cannot delete primary admin user ${cleanId}`);
      return false;
    }

    const deleted = this.users.delete(cleanId);
    if (deleted) {
      this.save();
      logger.info(`User ${cleanId} deleted from database`);
    }
    return deleted;
  }

  /**
   * Get all users
   */
  public getAllUsers(): BotUser[] {
    return Array.from(this.users.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Get approved users
   */
  public getApprovedUsers(): BotUser[] {
    return Array.from(this.users.values()).filter(u => u.status === 'approved');
  }

  /**
   * Get pending users
   */
  public getPendingUsers(): BotUser[] {
    return Array.from(this.users.values()).filter(u => u.status === 'pending');
  }

  /**
   * Get database statistics
   */
  public getStats(): {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    blocked: number;
  } {
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    let blocked = 0;

    for (const u of this.users.values()) {
      switch (u.status) {
        case 'approved':
          approved++;
          break;
        case 'pending':
          pending++;
          break;
        case 'rejected':
          rejected++;
          break;
        case 'blocked':
          blocked++;
          break;
      }
    }

    return {
      total: this.users.size,
      approved,
      pending,
      rejected,
      blocked
    };
  }
}
