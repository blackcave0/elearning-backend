// Load environment variables first
require("dotenv").config();

const { query, connectDatabase, closeDatabase } = require("../config/database");
const logger = require("../utils/logger");

const migrations = [
  {
    version: 1,
    name: "create_initial_tables",
    up: `
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        profile_image_url TEXT,
        email_verified BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Categories table
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        icon_name VARCHAR(100),
        color VARCHAR(7), -- Hex color code
        is_popular BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Courses table
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        instructor VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        rating DECIMAL(3,2) DEFAULT 0.0,
        total_lessons INTEGER DEFAULT 0,
        duration_minutes INTEGER DEFAULT 0,
        category_id INTEGER REFERENCES categories(id),
        level VARCHAR(50) DEFAULT 'Beginner', -- Beginner, Intermediate, Advanced
        tags TEXT[], -- Array of tags
        is_featured BOOLEAN DEFAULT FALSE,
        is_popular BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Lessons table
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        video_url TEXT,
        duration_minutes INTEGER DEFAULT 0,
        order_index INTEGER NOT NULL,
        is_preview BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Enrollments table
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        razorpay_order_id VARCHAR(255) UNIQUE,
        razorpay_payment_id VARCHAR(255),
        payment_status VARCHAR(50) DEFAULT 'pending', -- pending, completed, failed, refunded
        amount_paid DECIMAL(10,2),
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_completed_at TIMESTAMP,
        UNIQUE(user_id, course_id)
      );

      -- User Progress table
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        is_completed BOOLEAN DEFAULT FALSE,
        progress_percentage DECIMAL(5,2) DEFAULT 0.0,
        time_spent_minutes INTEGER DEFAULT 0,
        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        UNIQUE(user_id, course_id, lesson_id)
      );

      -- Reviews table
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, course_id)
      );
    `,
    down: `
      DROP TABLE IF EXISTS reviews;
      DROP TABLE IF EXISTS user_progress;
      DROP TABLE IF EXISTS enrollments;
      DROP TABLE IF EXISTS lessons;
      DROP TABLE IF EXISTS courses;
      DROP TABLE IF EXISTS categories;
      DROP TABLE IF EXISTS users;
    `,
  },
  {
    version: 2,
    name: "add_indexes",
    up: `
      -- Add indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_courses_category_id ON courses(category_id);
      CREATE INDEX IF NOT EXISTS idx_courses_is_featured ON courses(is_featured);
      CREATE INDEX IF NOT EXISTS idx_courses_is_popular ON courses(is_popular);
      CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses(is_active);
      CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
      CREATE INDEX IF NOT EXISTS idx_lessons_order_index ON lessons(course_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);
      CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
      CREATE INDEX IF NOT EXISTS idx_enrollments_payment_status ON enrollments(payment_status);
      CREATE INDEX IF NOT EXISTS idx_user_progress_user_course ON user_progress(user_id, course_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_course_id ON reviews(course_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
    `,
    down: `
      DROP INDEX IF EXISTS idx_reviews_rating;
      DROP INDEX IF EXISTS idx_reviews_course_id;
      DROP INDEX IF EXISTS idx_user_progress_user_course;
      DROP INDEX IF EXISTS idx_enrollments_payment_status;
      DROP INDEX IF EXISTS idx_enrollments_course_id;
      DROP INDEX IF EXISTS idx_enrollments_user_id;
      DROP INDEX IF EXISTS idx_lessons_order_index;
      DROP INDEX IF EXISTS idx_lessons_course_id;
      DROP INDEX IF EXISTS idx_courses_is_active;
      DROP INDEX IF EXISTS idx_courses_is_popular;
      DROP INDEX IF EXISTS idx_courses_is_featured;
      DROP INDEX IF EXISTS idx_courses_category_id;
      DROP INDEX IF EXISTS idx_users_email;
      DROP INDEX IF EXISTS idx_users_firebase_uid;
    `,
  },
  {
    version: 3,
    name: "add_migration_tracking",
    up: `
      -- Migration tracking table
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `
      DROP TABLE IF EXISTS migrations;
    `,
  },
];

async function getCurrentMigrationVersion() {
  try {
    const result = await query(
      "SELECT MAX(version) as version FROM migrations"
    );
    return result.rows[0]?.version || 0;
  } catch (error) {
    // If migrations table doesn't exist, return 0
    if (error.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

async function recordMigration(version, name) {
  try {
    await query("INSERT INTO migrations (version, name) VALUES ($1, $2)", [
      version,
      name,
    ]);
  } catch (error) {
    // Ignore if migrations table doesn't exist yet
    if (error.code !== "42P01") {
      throw error;
    }
  }
}

async function runMigrations() {
  try {
    await connectDatabase();
    logger.info("Starting database migrations...");

    const currentVersion = await getCurrentMigrationVersion();
    logger.info(`Current migration version: ${currentVersion}`);

    const pendingMigrations = migrations.filter(
      (m) => m.version > currentVersion
    );

    if (pendingMigrations.length === 0) {
      logger.info("No pending migrations");
      return;
    }

    logger.info(`Found ${pendingMigrations.length} pending migrations`);

    for (const migration of pendingMigrations) {
      logger.info(`Running migration ${migration.version}: ${migration.name}`);

      try {
        // Execute migration
        await query(migration.up);

        // Record migration (only if migrations table exists)
        await recordMigration(migration.version, migration.name);

        logger.info(`Migration ${migration.version} completed successfully`);
      } catch (error) {
        logger.error(`Migration ${migration.version} failed:`, error);
        throw error;
      }
    }

    logger.info("All migrations completed successfully");
  } catch (error) {
    logger.error("Migration failed:", error);
    throw error;
  }
}

async function rollbackMigration(targetVersion) {
  try {
    await connectDatabase();
    logger.info(`Rolling back to version ${targetVersion}...`);

    const currentVersion = await getCurrentMigrationVersion();

    if (currentVersion <= targetVersion) {
      logger.info("No rollback needed");
      return;
    }

    const migrationsToRollback = migrations
      .filter((m) => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Reverse order for rollback

    for (const migration of migrationsToRollback) {
      logger.info(
        `Rolling back migration ${migration.version}: ${migration.name}`
      );

      try {
        // Execute rollback
        await query(migration.down);

        // Remove from migrations table
        await query("DELETE FROM migrations WHERE version = $1", [
          migration.version,
        ]);

        logger.info(`Migration ${migration.version} rolled back successfully`);
      } catch (error) {
        logger.error(
          `Rollback of migration ${migration.version} failed:`,
          error
        );
        throw error;
      }
    }

    logger.info(`Rollback to version ${targetVersion} completed successfully`);
  } catch (error) {
    logger.error("Rollback failed:", error);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const version = parseInt(process.argv[3]);

  async function main() {
    try {
      if (command === "up") {
        await runMigrations();
      } else if (command === "down" && !isNaN(version)) {
        await rollbackMigration(version);
      } else {
        console.log("Usage:");
        console.log(
          "  node migrate.js up                 - Run all pending migrations"
        );
        console.log(
          "  node migrate.js down <version>     - Rollback to specific version"
        );
        process.exit(1);
      }
    } catch (error) {
      logger.error("Migration command failed:", error);
      process.exit(1);
    } finally {
      await closeDatabase();
    }
  }

  main();
}

module.exports = {
  runMigrations,
  rollbackMigration,
  migrations,
};
