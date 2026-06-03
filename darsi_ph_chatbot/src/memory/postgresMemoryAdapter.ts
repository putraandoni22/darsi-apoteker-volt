import pg from "pg";
import type {
  Conversation,
  ConversationQueryOptions,
  ConversationStepRecord,
  CreateConversationInput,
  GetMessagesOptions,
  StorageAdapter,
  WorkflowRunQuery,
  WorkflowStateEntry,
  WorkingMemoryScope,
} from "@voltagent/core";
import {
  ConversationAlreadyExistsError,
  ConversationNotFoundError,
} from "@voltagent/core";
import type { UIMessage } from "ai";
import { qualifyTable, sanitizeIdentifier } from "../utils/darsiDb.js";

type Logger = {
  debug: (msg: string, context?: unknown) => void;
  info: (msg: string, context?: unknown) => void;
  warn: (msg: string, context?: unknown) => void;
  error: (msg: string, context?: unknown) => void;
};

type PgMemoryAdapterOptions = {
  pool: pg.Pool;
  schema?: string;
  tablePrefix?: string;
  logger?: Logger;
};

function safeStringify(value: unknown, fallback = "[]"): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class PostgresMemoryAdapter implements StorageAdapter {
  private pool: pg.Pool;
  private schema: string;
  private tablePrefix: string;
  private initialized = false;
  private logger: Logger;

  constructor(options: PgMemoryAdapterOptions) {
    this.pool = options.pool;
    this.schema = sanitizeIdentifier(options.schema, "darsi_ph_memory");
    this.tablePrefix = sanitizeIdentifier(options.tablePrefix, "darsi_apoteker");
    this.logger = options.logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  private table(name: string): string {
    return qualifyTable(this.schema, name);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const usersTable = this.table(`${this.tablePrefix}_users`);
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const messagesTable = this.table(`${this.tablePrefix}_messages`);
    const workflowStatesTable = this.table(`${this.tablePrefix}_workflow_states`);
    const stepsTable = this.table(`${this.tablePrefix}_steps`);

    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${usersTable} (
        id TEXT PRIMARY KEY,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${conversationsTable} (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${messagesTable} (
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        parts TEXT NOT NULL,
        metadata TEXT,
        format_version INTEGER DEFAULT 2,
        created_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, message_id)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${workflowStatesTable} (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        suspension TEXT,
        events TEXT,
        output TEXT,
        cancellation TEXT,
        user_id TEXT,
        conversation_id TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${stepsTable} (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        operation_id TEXT,
        step_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        arguments TEXT,
        result TEXT,
        usage TEXT,
        sub_agent_id TEXT,
        sub_agent_name TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES ${conversationsTable}(id) ON DELETE CASCADE
      )
    `);

    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_conversations_user_id ON ${conversationsTable}(user_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_conversations_resource_id ON ${conversationsTable}(resource_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_messages_conversation_id ON ${messagesTable}(conversation_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_messages_created_at ON ${messagesTable}(created_at)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_workflow_states_workflow_id ON ${workflowStatesTable}(workflow_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_workflow_states_status ON ${workflowStatesTable}(status)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_steps_conversation ON ${stepsTable}(conversation_id, step_index)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}_steps_operation ON ${stepsTable}(conversation_id, operation_id)`);

    this.initialized = true;
  }

  async addMessage(message: UIMessage, userId: string, conversationId: string): Promise<void> {
    await this.initialize();
    const messagesTable = this.table(`${this.tablePrefix}_messages`);
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    await this.pool.query(
      `INSERT INTO ${messagesTable}
        (conversation_id, message_id, user_id, role, parts, metadata, format_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        conversationId,
        message.id,
        userId,
        message.role,
        safeStringify(message.parts ?? message.content ?? []),
        message.metadata ? safeStringify(message.metadata, "{}") : null,
        2,
        new Date().toISOString(),
      ],
    );
  }

  async addMessages(messages: UIMessage[], userId: string, conversationId: string): Promise<void> {
    await this.initialize();
    const messagesTable = this.table(`${this.tablePrefix}_messages`);
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    const client = await this.pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      for (const message of messages) {
        await client.query(
          `INSERT INTO ${messagesTable}
            (conversation_id, message_id, user_id, role, parts, metadata, format_version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            conversationId,
            message.id,
            userId,
            message.role,
            safeStringify(message.parts ?? message.content ?? []),
            message.metadata ? safeStringify(message.metadata, "{}") : null,
            2,
            now,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveConversationSteps(steps: ConversationStepRecord[]): Promise<void> {
    if (!steps.length) {
      return;
    }

    await this.initialize();
    const stepsTable = this.table(`${this.tablePrefix}_steps`);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const step of steps) {
        const createdAt = step.createdAt ?? new Date().toISOString();
        await client.query(
          `INSERT INTO ${stepsTable} (
            id,
            conversation_id,
            user_id,
            agent_id,
            agent_name,
            operation_id,
            step_index,
            type,
            role,
            content,
            arguments,
            result,
            usage,
            sub_agent_id,
            sub_agent_name,
            created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (id) DO UPDATE SET
            conversation_id = EXCLUDED.conversation_id,
            user_id = EXCLUDED.user_id,
            agent_id = EXCLUDED.agent_id,
            agent_name = EXCLUDED.agent_name,
            operation_id = EXCLUDED.operation_id,
            step_index = EXCLUDED.step_index,
            type = EXCLUDED.type,
            role = EXCLUDED.role,
            content = EXCLUDED.content,
            arguments = EXCLUDED.arguments,
            result = EXCLUDED.result,
            usage = EXCLUDED.usage,
            sub_agent_id = EXCLUDED.sub_agent_id,
            sub_agent_name = EXCLUDED.sub_agent_name,
            created_at = EXCLUDED.created_at`,
          [
            step.id,
            step.conversationId,
            step.userId,
            step.agentId,
            step.agentName ?? null,
            step.operationId ?? null,
            step.stepIndex,
            step.type,
            step.role,
            step.content ?? null,
            step.arguments ? safeStringify(step.arguments, "{}") : null,
            step.result ? safeStringify(step.result, "{}") : null,
            step.usage ? safeStringify(step.usage, "{}") : null,
            step.subAgentId ?? null,
            step.subAgentName ?? null,
            createdAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMessages(
    userId: string,
    conversationId: string,
    options?: GetMessagesOptions,
  ): Promise<UIMessage<{ createdAt: Date }>[]> {
    await this.initialize();
    const messagesTable = this.table(`${this.tablePrefix}_messages`);
    const args: unknown[] = [conversationId, userId];
    const conditions: string[] = ["conversation_id = $1", "user_id = $2"];

    if (options?.roles && options.roles.length > 0) {
      const rolePlaceholders: string[] = [];
      for (const role of options.roles) {
        args.push(role);
        rolePlaceholders.push(`$${args.length}`);
      }
      conditions.push(`role IN (${rolePlaceholders.join(",")})`);
    }

    if (options?.before) {
      args.push(options.before.toISOString());
      conditions.push(`created_at < $${args.length}`);
    }

    if (options?.after) {
      args.push(options.after.toISOString());
      conditions.push(`created_at > $${args.length}`);
    }

    let sql = `SELECT * FROM ${messagesTable} WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`;
    if (options?.limit && options.limit > 0) {
      args.push(options.limit);
      sql += ` LIMIT $${args.length}`;
    }

    const result = await this.pool.query(sql, args);
    return result.rows.map((row) => {
      const parts = parseJson(row.parts, []);
      const metadata = parseJson(row.metadata, {});
      return {
        id: row.message_id as string,
        role: row.role as string,
        parts: Array.isArray(parts) ? parts : [],
        metadata: {
          ...(metadata as Record<string, unknown>),
          createdAt: row.created_at ? new Date(row.created_at as string) : undefined,
        },
      } as UIMessage<{ createdAt: Date }>;
    });
  }

  async clearMessages(userId: string, conversationId?: string): Promise<void> {
    await this.initialize();
    const messagesTable = this.table(`${this.tablePrefix}_messages`);
    const stepsTable = this.table(`${this.tablePrefix}_steps`);
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);

    if (conversationId) {
      await this.pool.query(`DELETE FROM ${messagesTable} WHERE conversation_id = $1 AND user_id = $2`, [
        conversationId,
        userId,
      ]);
      await this.pool.query(`DELETE FROM ${stepsTable} WHERE conversation_id = $1 AND user_id = $2`, [
        conversationId,
        userId,
      ]);
      return;
    }

    await this.pool.query(
      `DELETE FROM ${messagesTable}
        WHERE conversation_id IN (
          SELECT id FROM ${conversationsTable} WHERE user_id = $1
        )`,
      [userId],
    );
    await this.pool.query(
      `DELETE FROM ${stepsTable}
        WHERE conversation_id IN (
          SELECT id FROM ${conversationsTable} WHERE user_id = $1
        )`,
      [userId],
    );
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    await this.initialize();
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const existing = await this.getConversation(input.id);
    if (existing) {
      throw new ConversationAlreadyExistsError(input.id);
    }

    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO ${conversationsTable}
        (id, resource_id, user_id, title, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.id,
        input.resourceId,
        input.userId,
        input.title,
        safeStringify(input.metadata || {}, "{}"),
        now,
        now,
      ],
    );

    return {
      id: input.id,
      userId: input.userId,
      resourceId: input.resourceId,
      title: input.title,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.initialize();
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const result = await this.pool.query(`SELECT * FROM ${conversationsTable} WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      userId: row.user_id as string,
      resourceId: row.resource_id as string,
      title: row.title as string,
      metadata: (parseJson(row.metadata, {}) as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async getConversations(resourceId: string): Promise<Conversation[]> {
    await this.initialize();
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const result = await this.pool.query(
      `SELECT * FROM ${conversationsTable} WHERE resource_id = $1 ORDER BY updated_at DESC`,
      [resourceId],
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      resourceId: row.resource_id as string,
      title: row.title as string,
      metadata: (parseJson(row.metadata, {}) as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async getConversationsByUserId(
    userId: string,
    options?: Omit<ConversationQueryOptions, "userId">,
  ): Promise<Conversation[]> {
    return this.queryConversations({ ...options, userId });
  }

  async queryConversations(options: ConversationQueryOptions): Promise<Conversation[]> {
    await this.initialize();
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (options.userId) {
      args.push(options.userId);
      conditions.push(`user_id = $${args.length}`);
    }

    if (options.resourceId) {
      args.push(options.resourceId);
      conditions.push(`resource_id = $${args.length}`);
    }

    let sql = `SELECT * FROM ${conversationsTable}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const orderBy = options.orderBy || "updated_at";
    const orderDirection = options.orderDirection || "DESC";
    sql += ` ORDER BY ${orderBy} ${orderDirection}`;

    if (options.limit) {
      args.push(options.limit);
      sql += ` LIMIT $${args.length}`;
    }

    if (options.offset) {
      args.push(options.offset);
      sql += ` OFFSET $${args.length}`;
    }

    const result = await this.pool.query(sql, args);
    return result.rows.map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      resourceId: row.resource_id as string,
      title: row.title as string,
      metadata: (parseJson(row.metadata, {}) as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async updateConversation(
    id: string,
    updates: Partial<Omit<Conversation, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Conversation> {
    await this.initialize();
    const conversation = await this.getConversation(id);
    if (!conversation) {
      throw new ConversationNotFoundError(id);
    }

    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    const now = new Date().toISOString();
    const fields: string[] = ["updated_at = $1"];
    const args: unknown[] = [now];

    if (updates.title !== undefined) {
      args.push(updates.title);
      fields.push(`title = $${args.length}`);
    }

    if (updates.resourceId !== undefined) {
      args.push(updates.resourceId);
      fields.push(`resource_id = $${args.length}`);
    }

    if (updates.metadata !== undefined) {
      args.push(safeStringify(updates.metadata, "{}"));
      fields.push(`metadata = $${args.length}`);
    }

    args.push(id);
    await this.pool.query(`UPDATE ${conversationsTable} SET ${fields.join(", ")} WHERE id = $${args.length}`, args);

    const updated = await this.getConversation(id);
    if (!updated) {
      throw new Error(`Conversation not found after update: ${id}`);
    }

    return updated;
  }

  async deleteConversation(id: string): Promise<void> {
    await this.initialize();
    const conversationsTable = this.table(`${this.tablePrefix}_conversations`);
    await this.pool.query(`DELETE FROM ${conversationsTable} WHERE id = $1`, [id]);
  }

  async getWorkingMemory(params: { conversationId?: string; userId?: string; scope: WorkingMemoryScope }): Promise<string | null> {
    await this.initialize();
    if (params.scope === "conversation" && params.conversationId) {
      const conversation = await this.getConversation(params.conversationId);
      return (conversation?.metadata as Record<string, unknown>)?.workingMemory as string | null;
    }

    if (params.scope === "user" && params.userId) {
      const usersTable = this.table(`${this.tablePrefix}_users`);
      const result = await this.pool.query(`SELECT metadata FROM ${usersTable} WHERE id = $1`, [params.userId]);
      if (result.rows.length > 0) {
        const metadata = parseJson(result.rows[0].metadata, {}) as Record<string, unknown>;
        return (metadata.workingMemory as string | null) ?? null;
      }
    }

    return null;
  }

  async setWorkingMemory(params: { conversationId?: string; userId?: string; content: string; scope: WorkingMemoryScope }): Promise<void> {
    await this.initialize();
    if (params.scope === "conversation" && params.conversationId) {
      const conversation = await this.getConversation(params.conversationId);
      if (!conversation) {
        throw new ConversationNotFoundError(params.conversationId);
      }
      const metadata = (conversation.metadata || {}) as Record<string, unknown>;
      metadata.workingMemory = params.content;
      await this.updateConversation(params.conversationId, { metadata });
    }

    if (params.scope === "user" && params.userId) {
      const usersTable = this.table(`${this.tablePrefix}_users`);
      const now = new Date().toISOString();
      const existing = await this.pool.query(`SELECT metadata FROM ${usersTable} WHERE id = $1`, [params.userId]);
      if (existing.rows.length > 0) {
        const metadata = parseJson(existing.rows[0].metadata, {}) as Record<string, unknown>;
        metadata.workingMemory = params.content;
        await this.pool.query(`UPDATE ${usersTable} SET metadata = $1, updated_at = $2 WHERE id = $3`, [
          safeStringify(metadata, "{}"),
          now,
          params.userId,
        ]);
      } else {
        await this.pool.query(
          `INSERT INTO ${usersTable} (id, metadata, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
          [params.userId, safeStringify({ workingMemory: params.content }, "{}"), now, now],
        );
      }
    }
  }

  async deleteWorkingMemory(params: { conversationId?: string; userId?: string; scope: WorkingMemoryScope }): Promise<void> {
    await this.initialize();
    if (params.scope === "conversation" && params.conversationId) {
      const conversation = await this.getConversation(params.conversationId);
      if (conversation?.metadata) {
        const metadata = { ...(conversation.metadata as Record<string, unknown>) };
        if (metadata.workingMemory) {
          delete metadata.workingMemory;
          await this.updateConversation(params.conversationId, { metadata });
        }
      }
    }

    if (params.scope === "user" && params.userId) {
      const usersTable = this.table(`${this.tablePrefix}_users`);
      const result = await this.pool.query(`SELECT metadata FROM ${usersTable} WHERE id = $1`, [params.userId]);
      if (result.rows.length > 0 && result.rows[0].metadata) {
        const metadata = parseJson(result.rows[0].metadata, {}) as Record<string, unknown>;
        if (metadata.workingMemory) {
          delete metadata.workingMemory;
          await this.pool.query(`UPDATE ${usersTable} SET metadata = $1, updated_at = $2 WHERE id = $3`, [
            safeStringify(metadata, "{}"),
            new Date().toISOString(),
            params.userId,
          ]);
        }
      }
    }
  }

  async getWorkflowState(executionId: string): Promise<WorkflowStateEntry | null> {
    await this.initialize();
    const workflowStatesTable = this.table(`${this.tablePrefix}_workflow_states`);
    const result = await this.pool.query(`SELECT * FROM ${workflowStatesTable} WHERE id = $1`, [executionId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      workflowId: row.workflow_id as string,
      workflowName: row.workflow_name as string,
      status: row.status as string,
      suspension: parseJson(row.suspension, undefined) as WorkflowStateEntry["suspension"],
      events: parseJson(row.events, undefined) as WorkflowStateEntry["events"],
      output: parseJson(row.output, undefined) as WorkflowStateEntry["output"],
      cancellation: parseJson(row.cancellation, undefined) as WorkflowStateEntry["cancellation"],
      userId: row.user_id as string | undefined,
      conversationId: row.conversation_id as string | undefined,
      metadata: parseJson(row.metadata, undefined) as WorkflowStateEntry["metadata"],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async queryWorkflowRuns(query: WorkflowRunQuery): Promise<WorkflowStateEntry[]> {
    await this.initialize();
    const workflowStatesTable = this.table(`${this.tablePrefix}_workflow_states`);
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (query.workflowId) {
      args.push(query.workflowId);
      conditions.push(`workflow_id = $${args.length}`);
    }

    if (query.status) {
      args.push(query.status);
      conditions.push(`status = $${args.length}`);
    }

    if (query.from) {
      args.push(query.from.toISOString());
      conditions.push(`created_at >= $${args.length}`);
    }

    if (query.to) {
      args.push(query.to.toISOString());
      conditions.push(`created_at <= $${args.length}`);
    }

    let sql = `SELECT * FROM ${workflowStatesTable}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += " ORDER BY created_at DESC";

    if (query.limit !== undefined) {
      args.push(query.limit);
      sql += ` LIMIT $${args.length}`;
    }

    if (query.offset !== undefined) {
      args.push(query.offset);
      sql += ` OFFSET $${args.length}`;
    }

    const result = await this.pool.query(sql, args);
    return result.rows.map((row) => ({
      id: row.id as string,
      workflowId: row.workflow_id as string,
      workflowName: row.workflow_name as string,
      status: row.status as string,
      suspension: parseJson(row.suspension, undefined) as WorkflowStateEntry["suspension"],
      events: parseJson(row.events, undefined) as WorkflowStateEntry["events"],
      output: parseJson(row.output, undefined) as WorkflowStateEntry["output"],
      cancellation: parseJson(row.cancellation, undefined) as WorkflowStateEntry["cancellation"],
      userId: row.user_id as string | undefined,
      conversationId: row.conversation_id as string | undefined,
      metadata: parseJson(row.metadata, undefined) as WorkflowStateEntry["metadata"],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));
  }

  async setWorkflowState(executionId: string, state: WorkflowStateEntry): Promise<void> {
    await this.initialize();
    const workflowStatesTable = this.table(`${this.tablePrefix}_workflow_states`);
    await this.pool.query(
      `INSERT INTO ${workflowStatesTable}
        (id, workflow_id, workflow_name, status, suspension, events, output, cancellation, user_id, conversation_id, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
        workflow_id = EXCLUDED.workflow_id,
        workflow_name = EXCLUDED.workflow_name,
        status = EXCLUDED.status,
        suspension = EXCLUDED.suspension,
        events = EXCLUDED.events,
        output = EXCLUDED.output,
        cancellation = EXCLUDED.cancellation,
        user_id = EXCLUDED.user_id,
        conversation_id = EXCLUDED.conversation_id,
        metadata = EXCLUDED.metadata,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        executionId,
        state.workflowId,
        state.workflowName,
        state.status,
        state.suspension ? safeStringify(state.suspension, "{}") : null,
        state.events ? safeStringify(state.events, "{}") : null,
        state.output ? safeStringify(state.output, "{}") : null,
        state.cancellation ? safeStringify(state.cancellation, "{}") : null,
        state.userId || null,
        state.conversationId || null,
        state.metadata ? safeStringify(state.metadata, "{}") : null,
        state.createdAt.toISOString(),
        state.updatedAt.toISOString(),
      ],
    );
  }

  async updateWorkflowState(
    executionId: string,
    updates: Partial<WorkflowStateEntry>,
  ): Promise<void> {
    await this.initialize();
    const existing = await this.getWorkflowState(executionId);
    if (!existing) {
      throw new Error(`Workflow state ${executionId} not found`);
    }

    const updated: WorkflowStateEntry = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    await this.setWorkflowState(executionId, updated);
  }

  async getSuspendedWorkflowStates(workflowId: string): Promise<WorkflowStateEntry[]> {
    await this.initialize();
    const workflowStatesTable = this.table(`${this.tablePrefix}_workflow_states`);
    const result = await this.pool.query(
      `SELECT * FROM ${workflowStatesTable} WHERE workflow_id = $1 AND status = 'suspended' ORDER BY created_at DESC`,
      [workflowId],
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      workflowId: row.workflow_id as string,
      workflowName: row.workflow_name as string,
      status: "suspended",
      suspension: parseJson(row.suspension, undefined) as WorkflowStateEntry["suspension"],
      events: parseJson(row.events, undefined) as WorkflowStateEntry["events"],
      output: parseJson(row.output, undefined) as WorkflowStateEntry["output"],
      cancellation: parseJson(row.cancellation, undefined) as WorkflowStateEntry["cancellation"],
      userId: row.user_id as string | undefined,
      conversationId: row.conversation_id as string | undefined,
      metadata: parseJson(row.metadata, undefined) as WorkflowStateEntry["metadata"],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));
  }
}
