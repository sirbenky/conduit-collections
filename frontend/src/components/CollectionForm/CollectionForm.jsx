import { useState } from "react";
import FormFieldset from "../FormFieldset";

//? Used for both create and rename. Pessimistic on purpose: submit is
//? disabled while the request is in flight, because the server owns the id
//? and can reject the name, and a row that appears and then disappears reads
//? as a bug. That also makes a double-clicked submit send one request.
function CollectionForm({ collection, error, onCancel, onSubmit, submitting }) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(
    collection?.description ?? "",
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    if (submitting || !name.trim()) return;

    onSubmit({ name: name.trim(), description: description.trim() || null });
  };

  return (
    <form className="collection-form" onSubmit={handleSubmit}>
      {error && (
        <ul className="error-messages">
          <li>{error}</li>
        </ul>
      )}

      <FormFieldset
        autoFocus
        handler={(event) => setName(event.target.value)}
        name="name"
        placeholder="Collection name"
        required
        value={name}
      />

      <FormFieldset
        handler={(event) => setDescription(event.target.value)}
        name="description"
        normal
        placeholder="Description (optional)"
        value={description}
      />

      <button
        className="btn btn-sm btn-outline-primary"
        disabled={submitting || !name.trim()}
        type="submit"
      >
        {submitting ? "Saving..." : collection ? "Save changes" : "Create"}
      </button>{" "}
      {onCancel && (
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      )}
    </form>
  );
}

export default CollectionForm;
