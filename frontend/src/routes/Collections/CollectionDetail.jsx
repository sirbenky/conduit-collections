import { useEffect, useState } from "react";
import ReactPaginate from "react-paginate";
import { Link, useNavigate, useParams } from "react-router-dom";
import ArticlesPreview from "../../components/ArticlesPreview";
import BannerContainer from "../../components/BannerContainer";
import ContainerRow from "../../components/ContainerRow";
import { useAuth } from "../../context/AuthContext";
import useCollectionArticles, {
  PAGE_SIZE,
} from "../../hooks/useCollectionArticles";
import getCollection from "../../services/getCollection";
import toggleCollectionArticle from "../../services/toggleCollectionArticle";

function CollectionDetail() {
  const { id } = useParams();
  const { headers, isAuth } = useAuth();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [collectionError, setCollectionError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);

  const {
    articles,
    articlesCount,
    error,
    goToPageAfterRemoval,
    loading,
    page,
    setArticlesData,
    setPage,
  } = useCollectionArticles({ id });

  useEffect(() => {
    if (!isAuth) navigate("/login", { replace: true });
  }, [isAuth, navigate]);

  useEffect(() => {
    if (!headers || !id) return;

    let current = true;

    getCollection({ headers, id })
      .then((data) => {
        if (current) setCollection(data);
      })
      .catch((message) => {
        if (current) setCollectionError(message);
      });

    return () => {
      current = false;
    };
  }, [headers, id]);

  const handleRemove = async (slug) => {
    setRemoving(slug);
    setRemoveError(null);

    try {
      await toggleCollectionArticle({ headers, id, saved: true, slug });

      //? Removing the last row on a page would otherwise leave the pager on
      //? a page that no longer exists.
      goToPageAfterRemoval();
      setCollection((previous) =>
        previous
          ? { ...previous, articlesCount: previous.articlesCount - 1 }
          : previous,
      );
    } catch (message) {
      setRemoveError(message);
    } finally {
      setRemoving(null);
    }
  };

  if (!isAuth) return null;

  if (collectionError) {
    return (
      <ContainerRow type="page">
        <div className="col-xs-12 col-md-10 offset-md-1">
          <p>{collectionError}</p>
          <Link to="/collections">Back to my collections</Link>
        </div>
      </ContainerRow>
    );
  }

  const totalPages = Math.ceil(articlesCount / PAGE_SIZE);

  return (
    <div className="collection-page">
      <BannerContainer>
        <h1>{collection?.name ?? "Collection"}</h1>
        {collection?.description && (
          <p className="collection-description">{collection.description}</p>
        )}
        <Link to="/collections">Back to my collections</Link>
      </BannerContainer>

      <ContainerRow type="page">
        <div className="col-xs-12 col-md-10 offset-md-1">
          {removeError && (
            <ul className="error-messages">
              <li>{removeError}</li>
            </ul>
          )}

          {loading && (
            <div className="article-preview">Loading articles...</div>
          )}

          {!loading && error && (
            <div className="article-preview">
              <p>Couldn&apos;t load this collection.</p>
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={() => setPage((current) => current)}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && articles.length === 0 && (
            <div className="article-preview">
              Nothing saved here yet. Open an article and use Save to add it.
            </div>
          )}

          {!loading && !error && articles.length > 0 && (
            <ArticlesPreview
              articles={articles}
              loading={loading}
              onRemove={handleRemove}
              removingSlug={removing}
              updateArticles={setArticlesData}
            />
          )}

          {totalPages > 1 && (
            <ReactPaginate
              activeClassName="active"
              breakClassName="page-item"
              breakLabel="..."
              breakLinkClassName="page-link"
              containerClassName="pagination pagination-sm"
              forcePage={page}
              nextClassName="page-item"
              nextLabel={<i className="ion-arrow-right-b"></i>}
              nextLinkClassName="page-link"
              onPageChange={({ selected }) => setPage(selected)}
              pageClassName="page-item"
              pageCount={totalPages}
              pageLinkClassName="page-link"
              previousClassName="page-item"
              previousLabel={<i className="ion-arrow-left-b"></i>}
              previousLinkClassName="page-link"
              renderOnZeroPageCount={null}
            />
          )}
        </div>
      </ContainerRow>
    </div>
  );
}

export default CollectionDetail;
