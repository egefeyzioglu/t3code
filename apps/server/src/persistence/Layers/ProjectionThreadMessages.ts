import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { ChatAttachment } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionThreadMessageInput,
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessageRepositoryShape,
  DeleteProjectionThreadMessagesInput,
  ListProjectionThreadMessagesInput,
  ProjectionThreadMessage,
  UpdateProjectionThreadMessageResponseStatsInput,
} from "../Services/ProjectionThreadMessages.ts";

const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    timeToFirstTokenMs: Schema.NullOr(Schema.Number),
    averageTokensPerSecond: Schema.NullOr(Schema.Number),
    totalTokens: Schema.NullOr(Schema.Number),
    inputTokens: Schema.NullOr(Schema.Number),
  }),
);

function responseStatsFromRow(
  row: Schema.Schema.Type<typeof ProjectionThreadMessageDbRowSchema>,
): ProjectionThreadMessage["responseStats"] | undefined {
  if (
    row.timeToFirstTokenMs === null &&
    row.averageTokensPerSecond === null &&
    row.totalTokens === null &&
    row.inputTokens === null
  ) {
    return undefined;
  }

  return {
    ...(row.timeToFirstTokenMs !== null ? { timeToFirstTokenMs: row.timeToFirstTokenMs } : {}),
    ...(row.averageTokensPerSecond !== null
      ? { averageTokensPerSecond: row.averageTokensPerSecond }
      : {}),
    ...(row.totalTokens !== null ? { totalTokens: row.totalTokens } : {}),
    ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : {}),
  };
}

function toProjectionThreadMessage(
  row: Schema.Schema.Type<typeof ProjectionThreadMessageDbRowSchema>,
): ProjectionThreadMessage {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    isStreaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    ...(responseStatsFromRow(row) !== undefined
      ? { responseStats: responseStatsFromRow(row) }
      : {}),
  };
}

const makeProjectionThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadMessageRow = SqlSchema.void({
    Request: ProjectionThreadMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      const hasResponseStats = row.responseStats !== undefined;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          time_to_first_token_ms,
          average_tokens_per_second,
          total_tokens,
          input_tokens,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${hasResponseStats ? (row.responseStats?.timeToFirstTokenMs ?? null) : null},
          ${hasResponseStats ? (row.responseStats?.averageTokensPerSecond ?? null) : null},
          ${hasResponseStats ? (row.responseStats?.totalTokens ?? null) : null},
          ${hasResponseStats ? (row.responseStats?.inputTokens ?? null) : null},
          ${row.isStreaming ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          time_to_first_token_ms = CASE
            WHEN ${hasResponseStats ? 1 : 0} = 1 THEN excluded.time_to_first_token_ms
            ELSE projection_thread_messages.time_to_first_token_ms
          END,
          average_tokens_per_second = CASE
            WHEN ${hasResponseStats ? 1 : 0} = 1 THEN excluded.average_tokens_per_second
            ELSE projection_thread_messages.average_tokens_per_second
          END,
          total_tokens = CASE
            WHEN ${hasResponseStats ? 1 : 0} = 1 THEN excluded.total_tokens
            ELSE projection_thread_messages.total_tokens
          END,
          input_tokens = CASE
            WHEN ${hasResponseStats ? 1 : 0} = 1 THEN excluded.input_tokens
            ELSE projection_thread_messages.input_tokens
          END,
          is_streaming = excluded.is_streaming,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const getProjectionThreadMessageRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadMessageInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          time_to_first_token_ms AS "timeToFirstTokenMs",
          average_tokens_per_second AS "averageTokensPerSecond",
          total_tokens AS "totalTokens",
          input_tokens AS "inputTokens",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `,
  });

  const listProjectionThreadMessageRows = SqlSchema.findAll({
    Request: ListProjectionThreadMessagesInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          time_to_first_token_ms AS "timeToFirstTokenMs",
          average_tokens_per_second AS "averageTokensPerSecond",
          total_tokens AS "totalTokens",
          input_tokens AS "inputTokens",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const deleteProjectionThreadMessageRows = SqlSchema.void({
    Request: DeleteProjectionThreadMessagesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `,
  });

  const updateProjectionThreadMessageResponseStatsRow = SqlSchema.void({
    Request: UpdateProjectionThreadMessageResponseStatsInput,
    execute: ({ messageId, responseStats, updatedAt }) =>
      sql`
        UPDATE projection_thread_messages
        SET
          time_to_first_token_ms = ${responseStats.timeToFirstTokenMs ?? null},
          average_tokens_per_second = ${responseStats.averageTokensPerSecond ?? null},
          total_tokens = ${responseStats.totalTokens ?? null},
          input_tokens = ${responseStats.inputTokens ?? null},
          updated_at = ${updatedAt}
        WHERE message_id = ${messageId}
      `,
  });

  const upsert: ProjectionThreadMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadMessageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.upsert:query")),
    );

  const getByMessageId: ProjectionThreadMessageRepositoryShape["getByMessageId"] = (input) =>
    getProjectionThreadMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.getByMessageId:query"),
      ),
      Effect.map(Option.map(toProjectionThreadMessage)),
    );

  const listByThreadId: ProjectionThreadMessageRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.listByThreadId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadMessage)),
    );

  const deleteByThreadId: ProjectionThreadMessageRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByThreadId:query"),
      ),
    );

  const updateResponseStats: ProjectionThreadMessageRepositoryShape["updateResponseStats"] = (
    input,
  ) =>
    updateProjectionThreadMessageResponseStatsRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.updateResponseStats:query"),
      ),
    );

  return {
    upsert,
    getByMessageId,
    listByThreadId,
    deleteByThreadId,
    updateResponseStats,
  } satisfies ProjectionThreadMessageRepositoryShape;
});

export const ProjectionThreadMessageRepositoryLive = Layer.effect(
  ProjectionThreadMessageRepository,
  makeProjectionThreadMessageRepository,
);
