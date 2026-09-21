"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Collection extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate({ Article, CollectionArticle, User }) {
      // define association here

      // Owner
      this.belongsTo(User, { foreignKey: "userId", as: "owner" });

      // Saved articles
      this.belongsToMany(Article, {
        through: CollectionArticle,
        as: "articles",
        foreignKey: "collectionId",
        otherKey: "articleId",
      });
    }

    //? userId never leaves the server. It is the thing every query is scoped
    //? by, so echoing it back only invites a client to try sending it in.
    toJSON() {
      return {
        ...this.get(),
        userId: undefined,
      };
    }
  }
  Collection.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING(60),
        allowNull: false,
        validate: {
          notBlank(value) {
            if (typeof value !== "string" || value.trim() === "") {
              throw new Error("A collection name is required");
            }
          },
          len: {
            args: [1, 60],
            msg: "A collection name must be 60 characters or fewer",
          },
        },
      },
      description: {
        type: DataTypes.STRING(280),
        allowNull: true,
        validate: {
          len: {
            args: [0, 280],
            msg: "A description must be 280 characters or fewer",
          },
        },
      },
    },
    {
      sequelize,
      modelName: "Collection",
    },
  );
  return Collection;
};
