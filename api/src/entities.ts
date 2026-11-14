import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
// Postgres in production, sql.js (in-memory SQLite) for local runs and tests.
const DATE = process.env.DATABASE_URL ? 'timestamptz' : 'datetime';

import type { Category, Priority, Role, Status } from './domain.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 100, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 16 })
  role: Role;

  @Column({ type: 'varchar', length: 80, nullable: true })
  department: string | null;
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 16 })
  category: Category;

  @Column({ type: 'varchar', length: 16 })
  priority: Priority;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: Status;

  @ManyToOne(() => User, { eager: true, nullable: false })
  requester: User;

  @ManyToOne(() => User, { eager: true, nullable: true })
  assignee: User | null;

  /** One-line summary written by the triage step, for the agent queue. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  aiSummary: string | null;

  /** Draft first reply for the agent to edit; never sent automatically. */
  @Column({ type: 'text', nullable: true })
  aiSuggestedReply: string | null;

  /** Which triage produced the fields above: "claude" or the "rules" fallback. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  triageSource: 'claude' | 'rules' | null;

  @Column({ type: DATE })
  slaDueAt: Date;

  @Column({ type: DATE, nullable: true })
  resolvedAt: Date | null;

  @OneToMany(() => Comment, (c) => c.ticket)
  comments: Comment[];

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, (t) => t.comments, { nullable: false, onDelete: 'CASCADE' })
  ticket: Ticket;

  @ManyToOne(() => User, { eager: true, nullable: false })
  author: User;

  @Column({ type: 'text' })
  body: string;

  /** Internal notes are visible to IT staff only. */
  @Column({ type: 'boolean', default: false })
  internal: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

export const ENTITIES = [User, Ticket, Comment];
