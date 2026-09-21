"use strict";

//? The four original migrations create Users, Articles, Comments and Tags but
//? none of the association columns or join tables. The app only worked because
//? index.js ran `sequelize.sync({ alter: true })` on every boot and quietly
//? added the rest. This migration adds exactly what sync() was creating, so a
//? clean database built from migrations matches the one the app has been
//? running on. Verified by diffing `pg_dump --schema-only` between a
//? sync-built database and a migration-built one.
//?
//? The ON DELETE rules below mirror sync()'s output rather than the intent in
//? the models: Sequelize falls back to SET NULL for a nullable foreign key, so
//? `Articles.userId` and `Comments.userId` are SET NULL even though the models
//? ask for CASCADE. Changing that is a behaviour change, not a migration fix,
//? so it stays as-is and is noted in the README.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Articles", "userId", {
      type: Sequelize.INTEGER,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("Comments", "articleId", {
      type: Sequelize.INTEGER,
      references: { model: "Articles", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    await queryInterface.addColumn("Comments", "userId", {
      type: Sequelize.INTEGER,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.createTable("Favorites", {
      articleId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: "Articles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      userId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
    });

    await queryInterface.createTable("Followers", {
      userId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      followerId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
    });

    await queryInterface.createTable("TagList", {
      articleId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: { model: "Articles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      tagName: {
        type: Sequelize.STRING,
        primaryKey: true,
        references: { model: "Tags", key: "name" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("TagList");
    await queryInterface.dropTable("Followers");
    await queryInterface.dropTable("Favorites");
    await queryInterface.removeColumn("Comments", "userId");
    await queryInterface.removeColumn("Comments", "articleId");
    await queryInterface.removeColumn("Articles", "userId");
  },
};
