import { useState } from "react";
import useCollections from "../../hooks/useCollections";
import setCollection from "../../services/setCollection";
import toggleCollectionArticle from "../../services/toggleCollectionArticle";
import { useAuth } from "../../context/AuthContext";

//? Mounted only while the picker is open, which is what makes it re-read
//? membership every time. ArticlesButtons renders twice on an article page
//? (banner and footer), so a copy kept in either one would go stale as soon
//? as the other was used.
function CollectionPicker({ onSaved, slug }) {
  const { collections, error, loading, reload, setCollections } =
    useCollections({ articleSlug: slug });
  const { headers } = useAuth();
  const [pending, setPending] = useState(() => new Set());
  const [actionError, setActionError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const markPending = (id, on) =>
    setPending((previous) => {
      const next = new Set(previous);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  //? Optimistic: a checkmark should appear the moment it is clicked. The
  //? previous value is captured first so a failure can put it back, rather
  //? than leaving the row showing something the server did not accept.
  const handleToggle = async (collection) => {
    const wasSaved = Boolean(collection.hasArticle);

    setActionError(null);
    markPending(collection.id, true);
    setCollections((previous) =>
      previous.map((item) =>
        item.id === collection.id
          ? {
              ...item,
              hasArticle: !wasSaved,
              articlesCount: item.articlesCount + (wasSaved ? -1 : 1),
            }
          : item,
      ),
    );

    try {
      const { saved } = await toggleCollectionArticle({
        headers,
        id: collection.id,
        saved: wasSaved,
        slug,
      });

      //? The service reports what the server ended up with, which is not
      //? always what we guessed: a 409 on add means it was already there.
      setCollections((previous) =>
        previous.map((item) =>
          item.id === collection.id ? { ...item, hasArticle: saved } : item,
        ),
      );
      onSaved?.();
    } catch (message) {
      setActionError(message);
      setCollections((previous) =>
        previous.map((item) =>
          item.id === collection.id
            ? {
                ...item,
                hasArticle: wasSaved,
                articlesCount: item.articlesCount + (wasSaved ? 1 : -1),
              }
            : item,
        ),
      );
    } finally {
      markPending(collection.id, false);
    }
  };

  //? Pessimistic, unlike the toggles: the server owns the new id and can
  //? reject the name, and a collection that appears and then vanishes is
  //? worse than a short wait.
  const handleCreate = async (event) => {
    event.preventDefault();
    if (saving || !newName.trim()) return;

    setSaving(true);
    setActionError(null);

    try {
      const created = await setCollection({ headers, name: newName });
      await toggleCollectionArticle({
        headers,
        id: created.id,
        saved: false,
        slug,
      });

      setNewName("");
      setCreating(false);
      reload();
      onSaved?.();
    } catch (message) {
      setActionError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="collection-picker-message">Loading collections...</p>;
  }

  if (error) {
    return (
      <div className="collection-picker-message">
        <p>Couldn&apos;t load your collections.</p>
        <button className="btn btn-sm btn-outline-primary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {actionError && (
        <ul className="error-messages collection-picker-error">
          <li>{actionError}</li>
        </ul>
      )}

      {collections.length === 0 && !creating && (
        <p className="collection-picker-message">
          You don&apos;t have any collections yet.
        </p>
      )}

      {collections.length > 0 && (
        <ul className="collection-picker-list">
          {collections.map((collection) => (
            <li key={collection.id}>
              <button
                aria-pressed={Boolean(collection.hasArticle)}
                className="collection-picker-row"
                disabled={pending.has(collection.id)}
                onClick={() => handleToggle(collection)}
                type="button"
              >
                <i
                  aria-hidden="true"
                  className={
                    collection.hasArticle
                      ? "ion-checkmark-round"
                      : "ion-ios-circle-outline"
                  }
                ></i>
                <span className="collection-picker-name">
                  {collection.name}
                </span>
                <span className="collection-picker-count">
                  {collection.articlesCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <form className="collection-picker-create" onSubmit={handleCreate}>
          <input
            aria-label="New collection name"
            autoFocus
            className="form-control"
            maxLength={60}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Collection name"
            value={newName}
          />
          <button
            className="btn btn-sm btn-outline-primary"
            disabled={saving || !newName.trim()}
            type="submit"
          >
            {saving ? "Saving..." : "Create and save"}
          </button>
        </form>
      ) : (
        <button
          className="btn btn-sm btn-outline-primary collection-picker-new"
          onClick={() => setCreating(true)}
          type="button"
        >
          <i aria-hidden="true" className="ion-plus-round"></i> New collection
        </button>
      )}
    </>
  );
}

export default CollectionPicker;
