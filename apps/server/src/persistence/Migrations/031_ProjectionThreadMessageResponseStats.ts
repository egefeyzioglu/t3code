import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN time_to_first_token_ms INTEGER
  `;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN average_tokens_per_second REAL
  `;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN total_tokens INTEGER
  `;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN input_tokens INTEGER
  `;
});
