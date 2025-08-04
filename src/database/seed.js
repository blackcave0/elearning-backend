// Load environment variables first
require("dotenv").config();

const { query, connectDatabase, closeDatabase } = require("../config/database");
const logger = require("../utils/logger");

const seedData = async () => {
  try {
    await connectDatabase();
    logger.info("Starting database seeding...");

    // Clear existing data (in reverse order due to foreign keys)
    await query("DELETE FROM user_progress");
    await query("DELETE FROM reviews");
    await query("DELETE FROM enrollments");
    await query("DELETE FROM lessons");
    await query("DELETE FROM courses");
    await query("DELETE FROM categories");
    await query("DELETE FROM users WHERE email LIKE $1", ["%test%"]);

    // Seed categories
    const categories = [
      {
        name: "Design",
        description: "UI/UX, Graphic Design, and Visual Arts",
        icon_name: "design_services",
        color: "#FF6B6B",
        is_popular: true,
      },
      {
        name: "Development",
        description: "Programming, Web & Mobile Development",
        icon_name: "code",
        color: "#4ECDC4",
        is_popular: true,
      },
      {
        name: "Marketing",
        description: "Digital Marketing, SEO, Social Media",
        icon_name: "campaign",
        color: "#45B7D1",
        is_popular: false,
      },
      {
        name: "Business",
        description: "Entrepreneurship, Management, Finance",
        icon_name: "business",
        color: "#96CEB4",
        is_popular: false,
      },
    ];

    for (const category of categories) {
      await query(
        `INSERT INTO categories (name, description, icon_name, color, is_popular)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          category.name,
          category.description,
          category.icon_name,
          category.color,
          category.is_popular,
        ]
      );
    }

    logger.info("Categories seeded successfully");

    // Get category IDs
    const categoryResult = await query("SELECT id, name FROM categories");
    const categoryMap = {};
    categoryResult.rows.forEach((row) => {
      categoryMap[row.name] = row.id;
    });

    // Seed courses
    const courses = [
      {
        title: "Complete UX/UI & App Design",
        description:
          "Master the fundamentals of user experience and interface design",
        image_url:
          "https://images.pexels.com/photos/196644/pexels-photo-196644.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
        instructor: "Sarah Johnson",
        price: 26.99,
        rating: 4.9,
        total_lessons: 24,
        duration_minutes: 480,
        category_id: categoryMap["Design"],
        level: "Intermediate",
        tags: ["UI/UX", "Design", "Mobile"],
        is_featured: true,
        is_popular: true,
      },
      {
        title: "Digital Marketing Masterclass",
        description: "Learn digital marketing strategies that actually work",
        image_url:
          "https://images.unsplash.com/photo-1557862921-37829c790f19?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1171&q=80",
        instructor: "Mike Chen",
        price: 19.99,
        rating: 4.7,
        total_lessons: 18,
        duration_minutes: 360,
        category_id: categoryMap["Marketing"],
        level: "Beginner",
        tags: ["Marketing", "Social Media", "SEO"],
        is_featured: false,
        is_popular: true,
      },
      {
        title: "Flutter App Development",
        description: "Build beautiful cross-platform mobile apps with Flutter",
        image_url:
          "https://images.unsplash.com/photo-1617040619263-41c5a9ca7521?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1170&q=80",
        instructor: "Alex Rodriguez",
        price: 29.99,
        rating: 4.8,
        total_lessons: 30,
        duration_minutes: 600,
        category_id: categoryMap["Development"],
        level: "Intermediate",
        tags: ["Flutter", "Mobile", "Dart"],
        is_featured: true,
        is_popular: false,
      },
      {
        title: "Python Programming",
        description: "Learn Python from scratch to advanced level",
        image_url:
          "https://images.pexels.com/photos/1181671/pexels-photo-1181671.jpeg?auto=compress&fit=crop&w=800&q=80",
        instructor: "Dr. Emily Watson",
        price: 21.99,
        rating: 4.6,
        total_lessons: 15,
        duration_minutes: 300,
        category_id: categoryMap["Development"],
        level: "Beginner",
        tags: ["Python", "Programming", "Backend"],
        is_featured: false,
        is_popular: false,
      },
    ];

    const courseIds = [];
    for (const course of courses) {
      const result = await query(
        `INSERT INTO courses (title, description, image_url, instructor, price, rating, total_lessons, duration_minutes, category_id, level, tags, is_featured, is_popular)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          course.title,
          course.description,
          course.image_url,
          course.instructor,
          course.price,
          course.rating,
          course.total_lessons,
          course.duration_minutes,
          course.category_id,
          course.level,
          course.tags,
          course.is_featured,
          course.is_popular,
        ]
      );
      courseIds.push(result.rows[0].id);
    }

    logger.info("Courses seeded successfully");

    // Seed lessons for each course
    for (let i = 0; i < courseIds.length; i++) {
      const courseId = courseIds[i];
      const lessonCount = courses[i].total_lessons;

      for (let j = 1; j <= Math.min(lessonCount, 5); j++) {
        // Create first 5 lessons for each course
        await query(
          `INSERT INTO lessons (course_id, title, description, video_url, duration_minutes, order_index, is_preview)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            courseId,
            `Lesson ${j}: ${j === 1 ? "Introduction" : j === 2 ? "Getting Started" : j === 3 ? "Basic Concepts" : j === 4 ? "Practical Examples" : "Advanced Topics"}`,
            `This is lesson ${j} of the course. Learn important concepts and practical skills.`,
            `https://example.com/video${courseId}_${j}.mp4`,
            Math.floor(Math.random() * 20) + 10, // Random duration between 10-30 minutes
            j,
            j === 1, // First lesson is always preview
          ]
        );
      }
    }

    logger.info("Lessons seeded successfully");
    logger.info("Database seeding completed successfully!");
  } catch (error) {
    logger.error("Database seeding failed:", error);
    throw error;
  }
};

// CLI interface
if (require.main === module) {
  async function main() {
    try {
      await seedData();
    } catch (error) {
      logger.error("Seeding command failed:", error);
      process.exit(1);
    } finally {
      await closeDatabase();
    }
  }

  main();
}

module.exports = { seedData };
