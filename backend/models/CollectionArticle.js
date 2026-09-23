"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  //? The join table is an explicit model rather than a string in
  //? belongsToMany, because membership is written directly with
  //? CollectionArticle.create(). Sequelize's generated collection.addArticle()
  //? does a SELECT first and silently skips a row that already exists, which
  //? turns a duplicate save into a false success and still races two
  //? concurrent requests. Going through the model lets the primary key reject
  //? the duplicate and the controller turn that into a 409.
  class CollectionArticle extends Model {
    static associate({ Article, Collection }) {
      this.belongsTo(Collection, { foreignKey: "collectionId" });
      this.belongsTo(Article, { foreignKey: "articleId" });
    }
  }
  CollectionArticle.init(
    {
      collectionId: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.UUID,
      },
      articleId: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
    },
    {
      sequelize,
      modelName: "CollectionArticle",
      tableName: "CollectionArticles",
      //? Created and removed, never edited, so there is no updatedAt.
      timestamps: true,
      updatedAt: false,
    },
  );
  return CollectionArticle;
};
