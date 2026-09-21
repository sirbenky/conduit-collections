import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import getCollectionArticles from "../services/getCollectionArticles";

export const PAGE_SIZE = 10;

//? Keeps the { articles, articlesCount } shape that useArticles returns, so
//? ArticlesPreview and its favourite handler work here unchanged.
function useCollectionArticles({ id }) {
  const [{ articles, articlesCount }, setArticlesData] = useState({
    articles: [],
    articlesCount: 0,
  });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { headers } = useAuth();

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!headers || !id) return;

    //? Without this, a slow response for page 2 arriving after page 3 would
    //? put page 2's rows on screen while the pager still reads 3.
    let current = true;

    setLoading(true);
    setError(null);

    getCollectionArticles({ headers, id, limit: PAGE_SIZE, page })
      .then((data) => {
        if (current) setArticlesData(data);
      })
      .catch((message) => {
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [headers, id, page, reloadToken]);

  //? Removing the last article on a page would otherwise leave the pager
  //? pointing at a page that no longer exists, showing an empty list under a
  //? pager that says there are more.
  const goToPageAfterRemoval = useCallback(() => {
    setPage((current) => {
      const remaining = articlesCount - 1;
      const lastPage = Math.max(0, Math.ceil(remaining / PAGE_SIZE) - 1);

      return Math.min(current, lastPage);
    });
    reload();
  }, [articlesCount, reload]);

  return {
    articles,
    articlesCount,
    error,
    goToPageAfterRemoval,
    loading,
    page,
    reload,
    setArticlesData,
    setPage,
  };
}

export default useCollectionArticles;
