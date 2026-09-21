import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CollectionForm from "../../components/CollectionForm";
import ContainerRow from "../../components/ContainerRow";
import { useAuth } from "../../context/AuthContext";
import useCollections from "../../hooks/useCollections";
import deleteCollection from "../../services/deleteCollection";
import setCollection from "../../services/setCollection";

function Collections() {
  const { headers, isAuth } = useAuth();
  const { collections, error, loading, reload } = useCollections();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  //? Same guard the settings and editor screens use. The server is what
  //? actually protects the data; this only spares a signed-out visitor a
  //? screen full of 401s.
  useEffect(() => {
    if (!isAuth) navigate("/login", { replace: true });
  }, [isAuth, navigate]);

  if (!isAuth) return null;

  const runSubmit = async (work) => {
    setSubmitting(true);
    setFormError(null);

    try {
      await work();
      reload();
      setCreating(false);
      setEditingId(null);
    } catch (message) {
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = (fields) =>
    runSubmit(() => setCollection({ headers, ...fields }));

  const handleRename = (id, fields) =>
    runSubmit(() => setCollection({ headers, id, ...fields }));

  const handleDelete = (id) =>
    runSubmit(async () => {
      await deleteCollection({ headers, id });
      setConfirmingId(null);
    });

  return (
    <div className="collections-page">
      <ContainerRow type="page">
        <div className="col-xs-12 col-md-10 offset-md-1">
          <div className="collections-header">
            <h1>My Collections</h1>
            {!creating && (
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={() => {
                  setCreating(true);
                  setFormError(null);
                }}
              >
                <i aria-hidden="true" className="ion-plus-round"></i> New
                collection
              </button>
            )}
          </div>

          {creating && (
            <CollectionForm
              error={formError}
              onCancel={() => {
                setCreating(false);
                setFormError(null);
              }}
              onSubmit={handleCreate}
              submitting={submitting}
            />
          )}

          {loading && <div className="article-preview">Loading collections...</div>}

          {!loading && error && (
            <div className="article-preview">
              <p>Couldn&apos;t load your collections.</p>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={reload}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && collections.length === 0 && !creating && (
            <div className="article-preview">
              You don&apos;t have any collections yet.
            </div>
          )}

          {!loading &&
            !error &&
            collections.map((collection) =>
              editingId === collection.id ? (
                <div className="article-preview" key={collection.id}>
                  <CollectionForm
                    collection={collection}
                    error={formError}
                    onCancel={() => {
                      setEditingId(null);
                      setFormError(null);
                    }}
                    onSubmit={(fields) => handleRename(collection.id, fields)}
                    submitting={submitting}
                  />
                </div>
              ) : (
                <div className="article-preview" key={collection.id}>
                  <Link
                    className="preview-link"
                    to={`/collections/${collection.id}`}
                  >
                    <h1>{collection.name}</h1>
                    {collection.description && <p>{collection.description}</p>}
                    <span>
                      {collection.articlesCount}{" "}
                      {collection.articlesCount === 1 ? "article" : "articles"}
                    </span>
                  </Link>

                  <div className="collection-actions">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => {
                        setEditingId(collection.id);
                        setConfirmingId(null);
                        setFormError(null);
                      }}
                    >
                      <i aria-hidden="true" className="ion-edit"></i> Edit
                    </button>{" "}
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => setConfirmingId(collection.id)}
                    >
                      <i aria-hidden="true" className="ion-trash-a"></i> Delete
                      collection
                    </button>
                  </div>

                  {/* Inline rather than a modal, matching the rest of the app */}
                  {confirmingId === collection.id && (
                    <div className="collection-confirm">
                      <span>
                        Delete this collection? The articles stay where they
                        are.
                      </span>{" "}
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={submitting}
                        onClick={() => handleDelete(collection.id)}
                      >
                        Delete
                      </button>{" "}
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
        </div>
      </ContainerRow>
    </div>
  );
}

export default Collections;
