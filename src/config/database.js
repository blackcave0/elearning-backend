const { Pool } = require("pg");
const logger = require("../utils/logger");

let pool = null;

const createPool = () => {
  if (!pool) {
    const config = {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 2000, // How long to wait when connecting a new client
    };

    // Always use individual components instead of connection string to avoid parsing issues
    config.host = process.env.DB_HOST || "localhost";
    config.port = parseInt(process.env.DB_PORT) || 5432;
    config.database = process.env.DB_NAME || "quipgen_elearning";
    config.user = process.env.DB_USER || "postgres";
    config.password = process.env.DB_PASSWORD
      ? String(process.env.DB_PASSWORD)
      : "";
    delete config.connectionString;

    pool = new Pool(config);

    // Handle pool errors
    pool.on("error", (err) => {
      logger.error("Unexpected error on idle client:", err);
    });

    pool.on("connect", () => {
      logger.info("New database connection established");
    });
  }

  return pool;
};

const connectDatabase = async () => {
  try {
    const dbPool = createPool();
    const client = await dbPool.connect();

    // Test the connection
    const result = await client.query("SELECT NOW()");
    logger.info("Database connected successfully at:", result.rows[0].now);

    client.release();
    return dbPool;
  } catch (error) {
    logger.error("Database connection failed:", error);
    throw error;
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error(
      "Database pool not initialized. Call connectDatabase() first."
    );
  }
  return pool;
};

const closeDatabase = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database pool closed");
  }
};

// Query helper function
const query = async (text, params) => {
  const start = Date.now();
  try {
    const dbPool = getPool();
    const result = await dbPool.query(text, params);
    const duration = Date.now() - start;

    logger.debug("Executed query", {
      text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      duration: `${duration}ms`,
      rows: result.rowCount,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error("Query error", {
      text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      duration: `${duration}ms`,
      error: error.message,
    });
    throw error;
  }
};

// Transaction helper function
const transaction = async (callback) => {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  connectDatabase,
  getPool,
  closeDatabase,
  query,
  transaction,
};
