"use strict";

//? Collections are private lists of articles. The invariants that matter -
//? one name per owner, no duplicate article in a collection - are enforced
//? here rather than only in application code, so a second process, a retry or
//? a direct SQL insert cannot get around them.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Collections", {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        //? gen_random_uuid() is core in Postgres 13+. The model also sets a
        //? UUIDV4 default, so rows created outside Sequelize still get an id.
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      userId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        //? A deleted user's private lists have no other owner, so they go too.
        onDelete: "CASCADE",
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING(60),
      },
      description: {
        allowNull: true,
        type: Sequelize.STRING(280),
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    //? NOT NULL alone would still allow "   ". Trim-and-compare in the
    //? database keeps the rule true no matter which client writes the row.
    await queryInterface.sequelize.query(
      `ALTER TABLE "Collections"
         ADD CONSTRAINT "Collections_name_not_blank"
         CHECK (btrim("name") <> '');`,
    );

    //? Case-insensitive uniqueness per owner: "Reading list" and "reading
    //? list" are the same collection as far as a person is concerned, and two
    //? of them in the save picker would be a coin toss. Expressed as a
    //? functional index because Sequelize cannot describe lower(name).
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "Collections_userId_lower_name"
         ON "Collections" ("userId", lower("name"));`,
    );

    await queryInterface.createTable("CollectionArticles", {
      collectionId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        references: { model: "Collections", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      articleId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.INTEGER,
        references: { model: "Articles", key: "id" },
        onUpdate: "CASCADE",
        //? Deleting an article removes it from every collection. The
        //? alternative - keeping a tombstone row - would mean every read has
        //? to filter out articles that no longer exist.
        onDelete: "CASCADE",
      },
      //? When the article was saved. There is no updatedAt: a membership is
      //? created and removed, never edited.
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    //? The detail page reads one collection newest-first, so the index is
    //? ordered the same way and the page comes straight off it.
    await queryInterface.sequelize.query(
      `CREATE INDEX "CollectionArticles_collectionId_createdAt"
         ON "CollectionArticles" ("collectionId", "createdAt" DESC);`,
    );

    //? The composite primary key starts with collectionId, so it cannot serve
    //? a lookup by articleId. Without this, deleting an article makes
    //? Postgres scan the whole membership table to cascade.
    await queryInterface.addIndex("CollectionArticles", ["articleId"], {
      name: "CollectionArticles_articleId",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CollectionArticles");
    await queryInterface.dropTable("Collections");
  },
};
