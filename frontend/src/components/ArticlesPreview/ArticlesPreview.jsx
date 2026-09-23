import { Link } from "react-router-dom";
import ArticleMeta from "../ArticleMeta";
import ArticleTags from "../ArticleTags";
import FavButton from "../FavButton";

//? onRemove is optional and only the collection detail page passes it. When
//? it is absent this renders exactly as it did before, so the home, profile
//? and favourites feeds are untouched.
function ArticlesPreview({
  articles,
  loading,
  onRemove,
  removingSlug,
  updateArticles,
}) {
  const handleFav = (article) => {
    const items = [...articles];

    const updatedArticles = items.map((item) =>
      item.slug === article.slug ? { ...item, ...article } : item,
    );

    updateArticles((prev) => ({ ...prev, articles: updatedArticles }));
  };

  return articles?.length > 0 ? (
    articles.map((article) => {
      return (
        <div className="article-preview" key={article.slug}>
          <ArticleMeta author={article.author} createdAt={article.createdAt}>
            {onRemove && (
              <button
                className="btn btn-sm btn-outline-danger pull-xs-right collection-remove"
                disabled={removingSlug === article.slug}
                onClick={() => onRemove(article.slug)}
                type="button"
              >
                {removingSlug === article.slug ? "Removing..." : "Remove"}
              </button>
            )}
            <FavButton
              favorited={article.favorited}
              favoritesCount={article.favoritesCount}
              handler={handleFav}
              right
              slug={article.slug}
            />
          </ArticleMeta>
          <Link
            to={`/article/${article.slug}`}
            state={article}
            className="preview-link"
          >
            <h1>{article.title}</h1>
            <p>{article.description}</p>
            <span>Read more...</span>
            <ArticleTags tagList={article.tagList} />
          </Link>
        </div>
      );
    })
  ) : loading ? (
    <div className="article-preview">Loading article...</div>
  ) : (
    <div className="article-preview">No articles available.</div>
  );
}

export default ArticlesPreview;
