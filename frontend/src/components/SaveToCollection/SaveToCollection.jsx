import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import CollectionPicker from "./CollectionPicker";

//? The entry point into Collections from the existing article experience.
//? Lives in ArticlesButtons so it appears wherever those buttons already do,
//? for authors and readers alike, and not at all for guests.
function SaveToCollection({ slug }) {
  const { isAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const buttonRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    //? Escape and a click outside both close it, and focus goes back to the
    //? button that opened it rather than to the top of the document.
    const close = () => {
      setOpen(false);
      buttonRef.current?.focus();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  if (!isAuth || !slug) return null;

  return (
    <span className="collection-picker" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className={`btn btn-sm btn-outline-primary ${savedOnce ? "active" : ""}`}
        onClick={() => setOpen((previous) => !previous)}
        ref={buttonRef}
        type="button"
      >
        <i
          aria-hidden="true"
          className={savedOnce ? "ion-bookmark" : "ion-ios-bookmarks-outline"}
        ></i>{" "}
        {savedOnce ? "Saved" : "Save"}
      </button>

      {open && (
        <div className="collection-picker-menu">
          <CollectionPicker onSaved={() => setSavedOnce(true)} slug={slug} />
        </div>
      )}
    </span>
  );
}

export default SaveToCollection;
